import { afterEach, describe, expect, it } from 'vitest';
import { ConflictError, ForbiddenError, ValidationError } from '../src/server/lib/errors.ts';
import { LATER_DIR, copyFixture, createLoadedWorld, type TestWorld } from './helpers.ts';

let world: TestWorld | undefined;
afterEach(() => {
  world?.container.close();
  world = undefined;
});

async function worldWithMinutes(...names: string[]): Promise<TestWorld> {
  const created = await createLoadedWorld();
  for (const name of names) copyFixture(LATER_DIR, name, created.driveDir);
  await created.container.sync.run('auto');
  return created;
}

function pendingFor(target: string | null) {
  return world?.container.suggestionService.list(['pending']).find((s) => s.targetActivityId === target) ?? null;
}

describe('accepting a suggestion', () => {
  it('updates the official activity, keeps the old deadline in history and points to spreadsheet and minutes', async () => {
    world = await worldWithMinutes('Ata_2026-10-03.md');
    const suggestion = pendingFor('ACT-101');
    const reviewed = world.container.reviewService.review(suggestion?.id ?? '', { decision: 'accept' }, 'U-B');
    expect(reviewed).toMatchObject({ status: 'accepted', reviewerName: 'Bruno', resultActivityId: 'ACT-101' });

    const act101 = world.container.activityService.detail('ACT-101');
    expect(act101.dueDate).toBe('2026-10-07');
    expect(act101.pendingSuggestionIds).toEqual([]);
    expect(act101.events.map((event) => event.kind)).toEqual(['suggestion_applied', 'imported']);
    expect(act101.events[0]?.changes).toContainEqual({ field: 'dueDate', before: '2026-10-05', after: '2026-10-07' });
    expect(act101.events[0]).toMatchObject({ actorName: 'Bruno', source: { name: 'Ata_2026-10-03.md' } });
    expect(act101.refs.map((ref) => ref.source.name)).toEqual(['Ata_registro.xlsx', 'Ata_2026-10-01.md', 'Ata_2026-10-03.md']);
    expect(world.container.activityService.list()).toHaveLength(4);
  });

  it('cannot be applied twice, even if the page is reopened and the button pressed again', async () => {
    world = await worldWithMinutes('Ata_2026-10-03.md');
    const id = pendingFor('ACT-101')?.id ?? '';
    world.container.reviewService.review(id, { decision: 'accept' }, 'U-B');
    expect(() => world?.container.reviewService.review(id, { decision: 'accept' }, 'U-C')).toThrow(ConflictError);
    expect(world.container.activityService.detail('ACT-101').events).toHaveLength(2);
  });

  it('is reserved to reviewers', async () => {
    world = await worldWithMinutes('Ata_2026-10-03.md');
    const id = pendingFor('ACT-101')?.id ?? '';
    expect(() => world?.container.reviewService.review(id, { decision: 'accept' }, 'U-A')).toThrow(ForbiddenError);
  });

  it('creates the new activity proposed by the minutes when accepted, with a new id', async () => {
    world = await worldWithMinutes('Ata_2026-10-04.md');
    const id = pendingFor(null)?.id ?? '';
    const reviewed = world.container.reviewService.review(id, { decision: 'accept' }, 'U-C');
    expect(reviewed.resultActivityId).toBe('ACT-105');
    const created = world.container.activityService.detail('ACT-105');
    expect(created).toMatchObject({ origin: 'suggestion', ownerIds: ['U-C'], dueDate: '2026-10-10', createdBy: 'U-C' });
    expect(created.refs[0]).toMatchObject({ relationType: 'created_by', source: { name: 'Ata_2026-10-04.md' } });
  });

  it('refuses to apply over a newer human edit unless the reviewer confirms', async () => {
    world = await worldWithMinutes('Ata_2026-10-03.md');
    const id = pendingFor('ACT-101')?.id ?? '';
    const current = world.container.activityService.detail('ACT-101');
    world.container.activityService.update('ACT-101', { dueDate: '2026-10-06', expectedVersion: current.version }, 'U-A');
    expect(() => world?.container.reviewService.review(id, { decision: 'accept' }, 'U-B')).toThrow(/mudou desde/);
    world.container.reviewService.review(id, { decision: 'accept', force: true }, 'U-B');
    expect(world.container.activityService.detail('ACT-101').dueDate).toBe('2026-10-07');
  });
});

describe('adjusting and rejecting', () => {
  it('adjust applies the reviewer values and records the suggestion as "adjusted"', async () => {
    world = await worldWithMinutes('Ata_2026-10-03.md');
    const id = pendingFor('ACT-101')?.id ?? '';
    const reviewed = world.container.reviewService.review(
      id,
      { decision: 'adjust', fields: { dueDate: '2026-10-08' }, note: 'Combinado com Ana' },
      'U-B',
    );
    expect(reviewed).toMatchObject({ status: 'adjusted', reviewNote: 'Combinado com Ana', appliedFields: { dueDate: '2026-10-08' } });
    expect(world.container.activityService.detail('ACT-101').dueDate).toBe('2026-10-08');
  });

  it('adjusting a new activity with an unknown owner is refused', async () => {
    world = await worldWithMinutes('Ata_2026-10-04.md');
    const id = pendingFor(null)?.id ?? '';
    expect(() =>
      world?.container.reviewService.review(id, { decision: 'adjust', fields: { ownerIds: ['U-X'] } }, 'U-C'),
    ).toThrow(ValidationError);
    expect(world.container.suggestionService.get(id).status).toBe('pending');
  });

  it('reject keeps the official activity untouched and stores the reason', async () => {
    world = await worldWithMinutes('Ata_2026-10-03.md');
    const id = pendingFor('ACT-101')?.id ?? '';
    const reviewed = world.container.reviewService.review(id, { decision: 'reject', note: 'Prazo ainda em discussão' }, 'U-C');
    expect(reviewed).toMatchObject({ status: 'rejected', reviewNote: 'Prazo ainda em discussão' });
    expect(world.container.activityService.detail('ACT-101').dueDate).toBe('2026-10-05');
  });

  it('a rejected suggestion is not proposed again when the same document is synchronized again', async () => {
    world = await worldWithMinutes('Ata_2026-10-03.md');
    const id = pendingFor('ACT-101')?.id ?? '';
    world.container.reviewService.review(id, { decision: 'reject', note: 'Não procede' }, 'U-C');
    await world.container.sync.run('manual');
    expect(world.container.suggestionService.list(['pending'])).toEqual([]);
  });
});
