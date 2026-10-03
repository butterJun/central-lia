import type { Member } from '../../shared/domain.ts';
import { stripMetaBlock } from '../ingestion/frontmatter.ts';
import { normalizeForMatch, stripInlineMarkdown } from '../lib/text.ts';
import type { AnalyzerInput, AnalyzerOutput, MinutesAnalyzer, RawProposal } from './contract.ts';

/**
 * Rule-based reader of meeting minutes, used when no LLM is configured (or as
 * fallback when the LLM fails). It recognizes the explicit patterns used by the
 * Liga's minutes: activity ids, "Fulano <verbo no futuro>", ISO dates,
 * "Próximo passo: ...", "de <data> para <data>" and hedging words. It is
 * deliberately conservative: anything it cannot read clearly is left out.
 */

const ACTIVITY_ID = /\bACT-\d+\b/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const DATE_CHANGE = /\bde\s+(\d{4}-\d{2}-\d{2})\s+para\s+(\d{4}-\d{2}-\d{2})/i;
const NEXT_STEP = /pr[oó]ximo passo(?:\s+d[eao]s?\s+[\p{L}]+)?\s*:\s*([^.\n]+)/iu;
const HEDGE = /\b(talvez|quem sabe|poder[ií]amos|possamos|pode ser que|ideia|hip[oó]tese|sem decis[aã]o|ningu[eé]m assumiu)\b/i;
const FUTURE_VERB = /^[\p{L}]+(ará|erá|irá|arão|erão|irão)$/iu;
const CONTINUITY_VERBS = new Set(['continua', 'segue', 'fica', 'assume', 'mantem', 'mantém', 'cuida', 'conduz']);
const APPROVAL_VERBS = /^(aprova|valida|autoriza|homologa)/i;
const OWNERSHIP_PHRASE = /responsabilidade\s+de\s+([\p{L}]+)/giu;
const LIST_MARKER = /^\s*(?:[-*•]|\d+[.)])\s+/;

interface Block {
  text: string;
  plain: string;
}

export class HeuristicAnalyzer implements MinutesAnalyzer {
  readonly name = 'heurística (regras determinísticas)';

  async analyze(input: AnalyzerInput): Promise<AnalyzerOutput> {
    const proposals = splitBlocks(input.documentText).flatMap((block) => readBlock(block, input.members));
    return { proposals, generator: this.name, warnings: [] };
  }
}

/** List items become one block each; consecutive plain lines form a paragraph block. */
export function splitBlocks(documentText: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push(toBlock(paragraph.join(' ')));
    paragraph = [];
  };
  for (const line of stripMetaBlock(documentText).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || /^#{1,6}\s/.test(trimmed)) {
      flush();
    } else if (LIST_MARKER.test(trimmed)) {
      flush();
      blocks.push(toBlock(trimmed.replace(LIST_MARKER, '')));
    } else {
      paragraph.push(trimmed);
    }
  }
  flush();
  return blocks;
}

function toBlock(text: string): Block {
  return { text, plain: stripInlineMarkdown(text) };
}

function readBlock(block: Block, members: Member[]): RawProposal[] {
  const ids = [...new Set(block.plain.match(ACTIVITY_ID) ?? [])];
  const hedged = HEDGE.test(block.plain);
  const owners = findOwners(block.plain, members);
  const due = findDueDate(block.plain);
  const nextStep = NEXT_STEP.exec(block.plain)?.[1]?.trim() ?? null;
  const status = /bloquead/i.test(block.plain) ? 'blocked' : /\bconclu[ií]d/i.test(block.plain) ? 'done' : null;
  const base = { evidence: block.text, owners, due_date: due.date, next_step: nextStep, status, uncertainties: due.uncertainties } as const;

  if (ids.length === 1) {
    return [{ ...base, kind: 'update', target_activity_id: ids[0] ?? null, title: null, reason: `Trecho menciona ${ids[0]}.` }];
  }
  if (ids.length > 1) {
    return [noAction(block, 'Trecho cita várias atividades ao mesmo tempo; revise manualmente.')];
  }
  if (hedged && owners.length === 0) {
    return [noAction(block, 'Ideia ou hipótese sem responsável nem decisão: não vira atividade.')];
  }
  const title = owners.length > 0 && !hedged ? extractTitle(block.plain, members) : null;
  if (title && (due.date || nextStep)) {
    return [{ ...base, kind: 'create', target_activity_id: null, title, reason: 'Nova ação com responsável registrada na ata.' }];
  }
  return [];
}

function noAction(block: Block, reason: string): RawProposal {
  return {
    kind: 'no_action',
    target_activity_id: null,
    title: null,
    owners: [],
    due_date: null,
    next_step: null,
    status: null,
    evidence: block.text,
    reason,
    uncertainties: [],
  };
}

function findDueDate(text: string): { date: string | null; uncertainties: string[] } {
  const change = DATE_CHANGE.exec(text);
  if (change) return { date: change[2] ?? null, uncertainties: [] };
  const dates = [...new Set(text.match(ISO_DATE) ?? [])];
  if (dates.length <= 1) return { date: dates[0] ?? null, uncertainties: [] };
  return { date: dates.at(-1) ?? null, uncertainties: ['O trecho tem mais de uma data; confirme qual é o prazo.'] };
}

interface Token {
  word: string;
  index: number;
}

function tokenize(text: string): Token[] {
  return [...text.matchAll(/[\p{L}\p{N}-]+/gu)].map((match) => ({ word: match[0], index: match.index ?? 0 }));
}

function memberByWord(word: string, members: Member[]): Member | undefined {
  const normalized = normalizeForMatch(word);
  return members.find((member) => normalizeForMatch(member.displayName) === normalized);
}

/** Members who take responsibility: "Ana seguirá", "Ana e Davi revisarão", "sob responsabilidade de Ana". */
export function findOwners(text: string, members: Member[]): string[] {
  const owners = new Set<string>();
  for (const match of text.matchAll(OWNERSHIP_PHRASE)) {
    const member = memberByWord(match[1] ?? '', members);
    if (member) owners.add(member.displayName);
  }
  const tokens = tokenize(text);
  tokens.forEach((token, position) => {
    if (!memberByWord(token.word, members)) return;
    const group: string[] = [];
    let cursor = position;
    while (cursor < tokens.length) {
      const current = tokens[cursor]?.word ?? '';
      const member = memberByWord(current, members);
      if (member) group.push(member.displayName);
      else if (normalizeForMatch(current) !== 'e') break;
      cursor += 1;
    }
    const verb = tokens[cursor]?.word ?? '';
    if (isCommitmentVerb(verb)) group.forEach((name) => owners.add(name));
  });
  return [...owners];
}

function isCommitmentVerb(word: string): boolean {
  if (APPROVAL_VERBS.test(word)) return false;
  return FUTURE_VERB.test(word) || CONTINUITY_VERBS.has(normalizeForMatch(word));
}

/** "Carla revisará a pauta ... e entregará X até 2026-10-10." → "Revisar a pauta ... e entregar X". */
export function extractTitle(text: string, members: Member[]): string | null {
  const tokens = tokenize(text);
  const verbToken = tokens.find(
    (token, index) => isCommitmentVerb(token.word) && memberByWord(tokens[index - 1]?.word ?? '', members),
  );
  if (!verbToken) return null;
  const rest = text.slice(verbToken.index);
  const clause = rest.split(/\s+at[eé]\s+|[.;:\n]/i)[0]?.trim() ?? '';
  const infinitive = clause
    .replace(/(?<!\p{L})(\p{L}+?)(ará|arão)(?!\p{L})/gu, '$1ar')
    .replace(/(?<!\p{L})(\p{L}+?)(erá|erão)(?!\p{L})/gu, '$1er')
    .replace(/(?<!\p{L})(\p{L}+?)(irá|irão)(?!\p{L})/gu, '$1ir');
  if (infinitive.split(/\s+/).length < 2) return null;
  return infinitive.charAt(0).toUpperCase() + infinitive.slice(1);
}
