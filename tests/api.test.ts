import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { Activity, ActivityDetail, Digest, Onboarding, Source, Suggestion, SyncStatus } from '../src/shared/domain.ts';
import { buildApp } from '../src/server/http/app.ts';
import { CONFLICT_DIR, LATER_DIR, copyFixture, createLoadedWorld, type TestWorld } from './helpers.ts';

let world: TestWorld | undefined;
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  world?.container.close();
  app = undefined;
  world = undefined;
});

async function start(): Promise<FastifyInstance> {
  world = await createLoadedWorld();
  app = await buildApp(world.container);
  return app;
}

function as(user: string) {
  return { 'x-demo-user': user };
}

describe('HTTP API', () => {
  it('lists activities and exposes detail with sources and history', async () => {
    const server = await start();
    const list = (await server.inject({ method: 'GET', url: '/api/activities' })).json<Activity[]>();
    expect(list.map((activity) => activity.id)).toEqual(['ACT-101', 'ACT-102', 'ACT-103', 'ACT-104']);
    const detail = (await server.inject({ method: 'GET', url: '/api/activities/ACT-104' })).json<ActivityDetail>();
    expect(detail.ownerIds).toEqual(['U-A', 'U-D']);
    expect(detail.refs[0]?.source.name).toBe('Ata_registro.xlsx');
    expect(detail.events).toHaveLength(1);
  });

  it('creates an activity, then edits it, requiring a demo profile', async () => {
    const server = await start();
    const anonymous = await server.inject({ method: 'POST', url: '/api/activities', payload: {} });
    expect(anonymous.statusCode).toBe(401);
    const invalid = await server.inject({ method: 'POST', url: '/api/activities', headers: as('U-A'), payload: { title: 'x', front: '', status: 'todo' } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.message).toMatch(/pelo menos 3 caracteres/);

    const created = await server.inject({
      method: 'POST',
      url: '/api/activities',
      headers: as('U-A'),
      payload: { title: 'Gravar vídeo', front: 'Growth', status: 'todo', ownerIds: ['U-A'], dueDate: '2026-10-30' },
    });
    expect(created.statusCode).toBe(201);
    const activity = created.json<Activity>();
    const edited = await server.inject({
      method: 'PATCH',
      url: `/api/activities/${activity.id}`,
      headers: as('U-B'),
      payload: { status: 'in_progress', expectedVersion: activity.version },
    });
    expect(edited.json<Activity>().status).toBe('in_progress');
    const stale = await server.inject({
      method: 'PATCH',
      url: `/api/activities/${activity.id}`,
      headers: as('U-B'),
      payload: { status: 'done', expectedVersion: activity.version },
    });
    expect(stale.statusCode).toBe(409);
  });

  it('runs a manual sync, reviews a suggestion and reports sync status', async () => {
    const server = await start();
    copyFixture(LATER_DIR, 'Ata_2026-10-03.md', world?.driveDir ?? '');
    copyFixture(CONFLICT_DIR, 'Ata - copia vazia.xlsx', world?.driveDir ?? '');
    const status = (await server.inject({ method: 'POST', url: '/api/sync/run' })).json<SyncStatus>();
    expect(status).toMatchObject({ mode: 'local', connected: true, stale: false, openConflicts: 1, counts: { processed: 8 } });
    expect(status.ai.provider).toBe('heuristic');

    const [pending] = (await server.inject({ method: 'GET', url: '/api/suggestions?status=pending' })).json<Suggestion[]>();
    const forbidden = await server.inject({ method: 'POST', url: `/api/suggestions/${pending?.id}/review`, headers: as('U-A'), payload: { decision: 'accept' } });
    expect(forbidden.statusCode).toBe(403);
    const accepted = await server.inject({ method: 'POST', url: `/api/suggestions/${pending?.id}/review`, headers: as('U-B'), payload: { decision: 'accept' } });
    expect(accepted.json<Suggestion>().status).toBe('accepted');
    const again = await server.inject({ method: 'POST', url: `/api/suggestions/${pending?.id}/review`, headers: as('U-B'), payload: { decision: 'accept' } });
    expect(again.statusCode).toBe(409);

    const sources = (await server.inject({ method: 'GET', url: '/api/sources' })).json<Source[]>();
    expect(sources.find((s) => s.name === 'Ata - copia vazia.xlsx')?.role).toBe('shadow_registry');
    expect(sources[0]).not.toHaveProperty('contentHash');
  });

  it('serves the personal digest, its narrative and the onboarding page', async () => {
    const server = await start();
    const digest = (await server.inject({ method: 'GET', url: '/api/digest?period=all', headers: as('U-D') })).json<Digest>();
    expect(digest.memberId).toBe('U-D');
    const narrative = (await server.inject({ method: 'POST', url: '/api/digest/narrative?period=all', headers: as('U-D') })).json<{ text: string }>();
    expect(narrative.text).toMatch(/^Davi/);
    const onboarding = (await server.inject({ method: 'GET', url: '/api/onboarding', headers: as('U-D') })).json<Onboarding>();
    expect(onboarding.firstAction?.id).toBe('ACT-102');
    const visit = await server.inject({ method: 'POST', url: '/api/session/visit', headers: as('U-D') });
    expect(visit.json()).toEqual({ previousVisitAt: null });
  });

  it('opens local originals (the Drive link in demo mode) and refuses unknown ids', async () => {
    const server = await start();
    const index = (await server.inject({ method: 'GET', url: '/api/sources' })).json<Source[]>().find((s) => s.name === 'INDEX.md');
    const response = await server.inject({ method: 'GET', url: index?.webUrl ?? '' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatch(/Índice do acervo/);
    expect((await server.inject({ method: 'GET', url: '/api/local-files/..%2F..%2Fsecret' })).statusCode).toBe(400);
    expect((await server.inject({ method: 'GET', url: '/api/local-files/local-0000' })).statusCode).toBe(404);
  });

  it('serves the web app: assets built after startup, SPA routes, and 404 for missing files', async () => {
    world = await createLoadedWorld();
    const dist = path.join(world.driveDir, '..', 'dist');
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>');
    world.container.config.webDistDir = dist;
    app = await buildApp(world.container);
    fs.writeFileSync(path.join(dist, 'assets', 'novo.js'), 'console.log(1)');
    const asset = await app.inject({ method: 'GET', url: '/assets/novo.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toMatch(/javascript/);
    const route = await app.inject({ method: 'GET', url: '/comece-aqui' });
    expect(route.headers['content-type']).toMatch(/text\/html/);
    expect((await app.inject({ method: 'GET', url: '/assets/sumiu.js' })).statusCode).toBe(404);
  });

  it('never exposes credentials and answers unknown API routes with JSON 404', async () => {
    const server = await start();
    const status = await server.inject({ method: 'GET', url: '/api/sync/status' });
    expect(status.body).not.toMatch(/apiKey|secret|token/i);
    const missing = await server.inject({ method: 'GET', url: '/api/nada' });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['x-content-type-options']).toBe('nosniff');
  });
});
