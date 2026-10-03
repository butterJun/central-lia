import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeNarrator } from '../src/server/digest/narrative.ts';
import { ClaudeAnalyzer, EXTRACTION_SYSTEM_PROMPT, buildUserMessage, type ClaudeMessagesClient } from '../src/server/suggestions/claude-analyzer.ts';
import type { RawProposal } from '../src/server/suggestions/contract.ts';
import { LATER_DIR, copyFixture, createLoadedWorld, type TestWorld } from './helpers.ts';

let world: TestWorld | undefined;
afterEach(() => {
  world?.container.close();
  world = undefined;
});

interface FakeResponse {
  stop_reason: string;
  parsed_output?: { proposals: RawProposal[] } | null;
  content?: Array<{ type: 'text'; text: string }>;
}

function fakeClaude(response: FakeResponse | Error): { client: ClaudeMessagesClient; requests: unknown[] } {
  const requests: unknown[] = [];
  const reply = async (params: unknown) => {
    requests.push(params);
    if (response instanceof Error) throw response;
    return response;
  };
  return { client: { messages: { parse: reply, create: reply } } as unknown as ClaudeMessagesClient, requests };
}

const ACT101_UPDATE: RawProposal = {
  kind: 'update',
  target_activity_id: 'ACT-101',
  title: null,
  owners: ['Ana'],
  due_date: '2026-10-07',
  next_step: 'fechar o roteiro e enviar para Bruno',
  status: null,
  evidence: 'O prazo para entregar a versão de aprovação mudou de 2026-10-05 para **2026-10-07**.',
  reason: 'Ata confirma novo prazo',
  uncertainties: [],
};

describe('Claude analyzer', () => {
  it('sends the document as data, with the current registry and members, using structured output', async () => {
    const { client, requests } = fakeClaude({ stop_reason: 'end_turn', parsed_output: { proposals: [ACT101_UPDATE] } });
    world = await createLoadedWorld({ analyzer: new ClaudeAnalyzer(client, 'claude-opus-5-5') });
    copyFixture(LATER_DIR, 'Ata_2026-10-03.md', world.driveDir);
    await world.container.sync.run('auto');

    const request = requests.at(-1) as { model: string; system: string; output_config: { effort: string; format: unknown }; messages: Array<{ content: string }> };
    expect(request.model).toBe('claude-opus-5-5');
    expect(request.system).toBe(EXTRACTION_SYSTEM_PROMPT);
    expect(request.output_config.effort).toBe('low');
    expect(request.output_config.format).toBeDefined();
    expect(request.messages[0]?.content).toMatch(/<documento nome="Ata_2026-10-03.md" data="2026-10-03">/);
    expect(request.messages[0]?.content).toMatch(/ACT-101: "Preparar carrossel sobre ferramentas"/);

    const [suggestion] = world.container.suggestionService.list(['pending']);
    expect(suggestion).toMatchObject({ generator: 'Claude (claude-opus-5-5)', proposed: { dueDate: '2026-10-07' } });
    expect(suggestion?.proposed.ownerIds).toBeUndefined();
  });

  it('only analyzes minutes, not direction or historical documents', async () => {
    const { client, requests } = fakeClaude({ stop_reason: 'end_turn', parsed_output: { proposals: [] } });
    world = await createLoadedWorld({ analyzer: new ClaudeAnalyzer(client, 'm') });
    const analyzed = requests.map((r) => /<documento nome="([^"]+)"/.exec((r as { messages: Array<{ content: string }> }).messages[0]?.content ?? '')?.[1]);
    expect(analyzed).toEqual(['Ata_2026-10-01.md']);
  });

  it('falls back to the rule-based reader when the model refuses, and says so', async () => {
    const { client } = fakeClaude({ stop_reason: 'refusal', parsed_output: null });
    world = await createLoadedWorld({ analyzer: new ClaudeAnalyzer(client, 'm') });
    copyFixture(LATER_DIR, 'Ata_2026-10-03.md', world.driveDir);
    await world.container.sync.run('auto');
    const source = world.container.repos.sources.list().find((s) => s.name === 'Ata_2026-10-03.md');
    expect(source?.analysis?.warnings[0]).toMatch(/IA indisponível \(o modelo recusou/);
    expect(world.container.suggestionService.list(['pending'])[0]?.generator).toMatch(/heurística/);
  });

  it('falls back when the API is unreachable', async () => {
    const { client } = fakeClaude(new Error('connect ECONNREFUSED'));
    world = await createLoadedWorld({ analyzer: new ClaudeAnalyzer(client, 'm') });
    copyFixture(LATER_DIR, 'Ata_2026-10-04.md', world.driveDir);
    await world.container.sync.run('auto');
    expect(world.container.suggestionService.list(['pending'])).toHaveLength(1);
  });

  it('describes the registry with names and dates, never internal ids only', () => {
    const message = buildUserMessage({
      documentName: 'a"b<c>.md',
      documentDate: null,
      documentText: 'texto',
      members: [{ id: 'U-A', displayName: 'Ana', front: 'Growth', role: 'member', description: '' }],
      activities: [],
    });
    expect(message).toMatch(/<documento nome="abc.md" data="desconhecida">/);
    expect(message).toMatch(/- Ana \(Growth\)/);
  });
});

describe('Claude narrator', () => {
  it('uses the model text when its dates are grounded and falls back otherwise', async () => {
    world = await createLoadedWorld();
    const digest = world.container.digestService.build('U-A', 'all');
    const good = fakeClaude({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ana, seu prazo de ACT-101 é 05/10.' }] });
    expect(await new ClaudeNarrator(good.client, 'm').narrate(digest, 'Ana')).toMatchObject({ generator: 'Claude (m)', warning: null });
    const invented = fakeClaude({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ana, seu prazo é 25/12.' }] });
    const fallback = await new ClaudeNarrator(invented.client, 'm').narrate(digest, 'Ana');
    expect(fallback.warning).toMatch(/data fora dos registros/);
    expect(fallback.text).toMatch(/^Ana:/);
  });
});
