import { afterEach, describe, expect, it } from 'vitest';
import { ConflictError, ValidationError } from '../src/server/lib/errors.ts';
import { createLoadedWorld, createTestWorld, type TestWorld } from './helpers.ts';

let world: TestWorld | undefined;
afterEach(() => {
  world?.container.close();
  world = undefined;
});

const NEW_ACTIVITY = {
  title: 'Organizar vídeo de boas-vindas',
  description: 'Vídeo curto para novos membros',
  nextStep: 'Escrever roteiro',
  ownerIds: ['U-D'],
  front: 'Operações',
  status: 'todo' as const,
  dueDate: '2026-10-20',
};

describe('manual activities', () => {
  it('a created activity survives an application restart with author and history', async () => {
    world = await createLoadedWorld();
    const created = world.container.activityService.create(NEW_ACTIVITY, 'U-D');
    expect(created).toMatchObject({ id: 'ACT-105', origin: 'manual', createdBy: 'U-D', version: 1 });

    const restarted = world.restart();
    const detail = restarted.activityService.detail('ACT-105');
    expect(detail.title).toBe(NEW_ACTIVITY.title);
    expect(detail.events[0]).toMatchObject({ kind: 'created', actorName: 'Davi', reason: 'Criada manualmente na interface' });
  });

  it('records only the fields that changed, with author, time and reason', async () => {
    world = await createLoadedWorld();
    const act102 = world.container.activityService.detail('ACT-102');
    world.container.activityService.update(
      'ACT-102',
      { status: 'in_progress', nextStep: act102.nextStep, expectedVersion: act102.version, reason: 'Comecei hoje' },
      'U-D',
    );
    const [event] = world.container.activityService.detail('ACT-102').events;
    expect(event).toMatchObject({ kind: 'updated', actorId: 'U-D', reason: 'Comecei hoje' });
    expect(event?.changes).toEqual([{ field: 'status', before: 'todo', after: 'in_progress' }]);
    expect(Date.parse(event?.timestamp ?? '')).not.toBeNaN();
  });

  it('can complete or block an activity', async () => {
    world = await createLoadedWorld();
    const act104 = world.container.activityService.detail('ACT-104');
    const done = world.container.activityService.update('ACT-104', { status: 'done', expectedVersion: act104.version }, 'U-A');
    expect(done.status).toBe('done');
    const blocked = world.container.activityService.update('ACT-104', { status: 'blocked', expectedVersion: done.version }, 'U-A');
    expect(blocked.status).toBe('blocked');
  });

  it('a no-op save does not create history noise', async () => {
    world = await createLoadedWorld();
    const act101 = world.container.activityService.detail('ACT-101');
    world.container.activityService.update('ACT-101', { title: act101.title, expectedVersion: act101.version }, 'U-A');
    expect(world.container.activityService.detail('ACT-101').events).toHaveLength(1);
  });

  it('rejects a stale edit (optimistic locking) instead of silently overwriting', async () => {
    world = await createLoadedWorld();
    const { version } = world.container.activityService.detail('ACT-101');
    world.container.activityService.update('ACT-101', { nextStep: 'Revisar exemplos', expectedVersion: version }, 'U-A');
    expect(() =>
      world?.container.activityService.update('ACT-101', { nextStep: 'Outra coisa', expectedVersion: version }, 'U-B'),
    ).toThrow(ConflictError);
  });

  it('rejects unknown owners', () => {
    world = createTestWorld();
    expect(() => world?.container.activityService.create({ ...NEW_ACTIVITY, ownerIds: ['U-Z'] }, 'U-A')).toThrow(ValidationError);
  });

  it('numbers manual activities after the highest existing id', () => {
    world = createTestWorld();
    expect(world.container.activityService.create(NEW_ACTIVITY, 'U-A').id).toBe('ACT-101');
    expect(world.container.activityService.create(NEW_ACTIVITY, 'U-A').id).toBe('ACT-102');
  });
});
