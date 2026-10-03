import { afterEach, describe, expect, it } from 'vitest';
import { datesAreGrounded, templateNarrative } from '../src/server/digest/narrative.ts';
import { LATER_DIR, copyFixture, createLoadedWorld, type TestWorld } from './helpers.ts';

let world: TestWorld | undefined;
afterEach(() => {
  world?.container.close();
  world = undefined;
});

describe('"what changed for me"', () => {
  it('shows a pending proposal to Ana but not to Davi, and keeps it apart from confirmed facts', async () => {
    world = await createLoadedWorld();
    copyFixture(LATER_DIR, 'Ata_2026-10-03.md', world.driveDir);
    await world.container.sync.run('auto');
    const ana = world.container.digestService.build('U-A', 'all');
    const davi = world.container.digestService.build('U-D', 'all');
    expect(ana.pending.map((s) => s.targetActivityId)).toEqual(['ACT-101']);
    expect(davi.pending).toEqual([]);
    expect(ana.confirmed.every((change) => change.kind === 'imported')).toBe(true);
  });

  it('after approval, the change appears as confirmed for Ana only, with its source', async () => {
    world = await createLoadedWorld();
    const before = new Date().toISOString();
    copyFixture(LATER_DIR, 'Ata_2026-10-03.md', world.driveDir);
    await world.container.sync.run('auto');
    const [suggestion] = world.container.suggestionService.list(['pending']);
    world.container.reviewService.review(suggestion?.id ?? '', { decision: 'accept' }, 'U-B');

    world.container.repos.members.recordVisit('U-A', before);
    world.container.repos.members.recordVisit('U-A', new Date(Date.now() + 3_600_000).toISOString());
    world.container.repos.members.recordVisit('U-D', before);
    world.container.repos.members.recordVisit('U-D', new Date(Date.now() + 3_600_000).toISOString());
    const ana = world.container.digestService.build('U-A', 'last_visit');
    const davi = world.container.digestService.build('U-D', 'last_visit');
    expect(ana.confirmed).toHaveLength(1);
    expect(ana.confirmed[0]).toMatchObject({ activityId: 'ACT-101', actorName: 'Bruno', source: { name: 'Ata_2026-10-03.md' } });
    expect(davi.confirmed).toEqual([]);
    expect(ana.pending).toEqual([]);
  });

  it('flags overdue, upcoming and blocked work using the São Paulo calendar', async () => {
    world = await createLoadedWorld();
    const now = new Date('2026-10-08T02:00:00Z');
    const ana = world.container.digestService.build('U-A', 'all', now);
    expect(ana.overdue.map((a) => a.id)).toEqual(['ACT-101']);
    const carla = world.container.digestService.build('U-C', 'all', now);
    expect(carla.dueSoon.map((a) => a.id)).toEqual(['ACT-103']);
    expect(carla.blocked.map((a) => a.id)).toEqual(['ACT-103']);
  });

  it('marks uncertain data: shadow spreadsheet conflict and suggestion uncertainties', async () => {
    world = await createLoadedWorld();
    copyFixture(LATER_DIR, 'Ata_2026-10-04.md', world.driveDir);
    await world.container.sync.run('auto');
    const carla = world.container.digestService.build('U-C', 'all');
    expect(carla.pending).toHaveLength(1);
    expect(carla.uncertain.some((note) => /Frente inferida/.test(note.text))).toBe(true);
  });

  it('says so when nothing changed', async () => {
    world = await createLoadedWorld();
    world.container.repos.members.recordVisit('U-N', new Date(Date.now() + 1000).toISOString());
    world.container.repos.members.recordVisit('U-N', new Date(Date.now() + 3_600_000).toISOString());
    const digest = world.container.digestService.build('U-N', 'last_visit');
    expect(digest.nothingChanged).toBe(true);
    expect(templateNarrative(digest, 'Novo membro')).toMatch(/nada mudou/);
  });

  it('rejects narrative text that cites dates absent from the records', async () => {
    world = await createLoadedWorld();
    const digest = world.container.digestService.build('U-A', 'all');
    expect(datesAreGrounded('Seu prazo é 05/10.', digest)).toBe(true);
    expect(datesAreGrounded('Seu prazo é 2026-10-05.', digest)).toBe(true);
    expect(datesAreGrounded('Seu prazo mudou para 20/12.', digest)).toBe(false);
  });
});

describe('"Comece aqui"', () => {
  it('builds the entry page from direction documents and marks partial facts as such', async () => {
    world = await createLoadedWorld();
    const onboarding = world.container.onboardingService.build('U-A');
    expect(onboarding.purpose).toMatchObject({ partial: true, source: { name: 'ESTADO-ATUAL.md' } });
    expect(onboarding.purpose?.markdown).toMatch(/treina pessoas para aplicar IA/);
    expect(onboarding.fronts?.markdown).toMatch(/Growth/);
    expect(onboarding.steps?.markdown).toMatch(/ESTADO-ATUAL\.md/);
    expect(onboarding.documents.map((doc) => doc.source.name)).toEqual(
      expect.arrayContaining(['ESTADO-ATUAL.md', 'GUIA_INICIAL.md', 'Ata_registro.xlsx', 'Ata_2026-10-01.md']),
    );
    expect(onboarding.documents.find((doc) => doc.source.name === 'ESTADO-ATUAL.md')?.partial).toBe(true);
    expect(onboarding.historical).toEqual([expect.objectContaining({ supersededBy: 'GUIA_INICIAL.md em 2026-10-01' })]);
    expect(onboarding.registry?.source.name).toBe('Ata_registro.xlsx');
    expect(onboarding.precedenceRule).toMatch(/^decisão humana aprovada/);
    expect(onboarding.firstAction?.id).toBe('ACT-101');
    expect(onboarding.gaps.join(' ')).toMatch(/parcial/);
    expect(onboarding.gaps.join(' ')).toMatch(/Bruno/);
  });

  it('tells a brand-new member that no activity is assigned yet', async () => {
    world = await createLoadedWorld();
    const onboarding = world.container.onboardingService.build('U-N');
    expect(onboarding.firstAction).toBeNull();
    expect(onboarding.gaps.join(' ')).toMatch(/ainda não tem atividade/);
  });
});
