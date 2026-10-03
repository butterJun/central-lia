import fs from 'node:fs';
import path from 'node:path';
import { OAuth2Client } from 'google-auth-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, loadConfig } from '../src/server/config.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { DRIVE_SCOPE, GoogleAuthService } from '../src/server/drive/google-auth.ts';
import { ValidationError } from '../src/server/lib/errors.ts';
import { KvRepo } from '../src/server/repositories/kv-repo.ts';
import { SyncScheduler } from '../src/server/sync/scheduler.ts';
import type { SyncService } from '../src/server/sync/sync-service.ts';
import { LATER_DIR, copyFixture, createLoadedWorld, writeFileBumped, type TestWorld } from './helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const SECRET = 'x'.repeat(32);
const GOOGLE_ENV = {
  DRIVE_MODE: 'google',
  GOOGLE_CLIENT_ID: 'test-client',
  GOOGLE_CLIENT_SECRET: 'test-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:4000/auth/google/callback',
  DRIVE_TEST_FOLDER_ID: 'folder123',
  APP_SECRET: SECRET,
};

describe('configuration', () => {
  it('defaults to the local demo mode with rule-based AI when nothing is configured', () => {
    const config = loadConfig({}, [], ROOT);
    expect(config).toMatchObject({ driveMode: 'local', port: 4000, host: '127.0.0.1', syncIntervalSeconds: 120, google: null });
    expect(config.ai).toMatchObject({ provider: 'heuristic', apiKey: null });
  });

  it('--demo forces the local folder and a separate database even if Google is configured', () => {
    const config = loadConfig(GOOGLE_ENV, ['--demo'], ROOT);
    expect(config.driveMode).toBe('local');
    expect(config.databaseFile).toMatch(/demo[\\/]central-local\.sqlite$/);
  });

  it('Google mode lists every missing variable and rejects a short APP_SECRET', () => {
    expect(() => loadConfig({ DRIVE_MODE: 'google' }, [], ROOT)).toThrow(/GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, DRIVE_TEST_FOLDER_ID, APP_SECRET/);
    expect(() => loadConfig({ ...GOOGLE_ENV, APP_SECRET: 'curto' }, [], ROOT)).toThrow(ConfigError);
    expect(loadConfig(GOOGLE_ENV, [], ROOT).google).toMatchObject({ folderId: 'folder123' });
  });

  it('uses Claude only with a key, and refuses AI_PROVIDER=claude without one', () => {
    expect(loadConfig({ ANTHROPIC_API_KEY: 'sk-test' }, [], ROOT).ai).toMatchObject({ provider: 'claude', model: 'claude-haiku-4-5' });
    expect(loadConfig({ ANTHROPIC_API_KEY: 'sk-test', AI_PROVIDER: 'heuristic' }, [], ROOT).ai.provider).toBe('heuristic');
    expect(() => loadConfig({ AI_PROVIDER: 'claude' }, [], ROOT)).toThrow(/exige ANTHROPIC_API_KEY/);
    expect(() => loadConfig({ SYNC_INTERVAL_SECONDS: '5' }, [], ROOT)).toThrow(/Configuração inválida/);
  });
});

describe('Google OAuth flow', () => {
  afterEach(() => vi.restoreAllMocks());

  function service() {
    const kv = new KvRepo(openDatabase(':memory:'));
    const config = loadConfig(GOOGLE_ENV, [], ROOT).google;
    if (!config) throw new Error('google config expected');
    return { kv, auth: new GoogleAuthService(config, kv, SECRET) };
  }

  it('asks only for read-only Drive access, offline, with a CSRF state', () => {
    const { auth } = service();
    const url = new URL(auth.createAuthUrl());
    expect(url.searchParams.get('scope')).toBe(DRIVE_SCOPE);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('state')).toMatch(/^[0-9a-f]{48}$/);
    expect(url.searchParams.get('redirect_uri')).toBe(GOOGLE_ENV.GOOGLE_REDIRECT_URI);
  });

  it('rejects a callback with an unknown or reused state', async () => {
    const { auth } = service();
    await expect(auth.handleCallback('code', 'forjado')).rejects.toBeInstanceOf(ValidationError);
    const state = new URL(auth.createAuthUrl()).searchParams.get('state') ?? '';
    vi.spyOn(OAuth2Client.prototype, 'getToken').mockResolvedValue({ tokens: { refresh_token: 'r1', access_token: 'a1' }, res: null } as never);
    await auth.handleCallback('code', state);
    await expect(auth.handleCallback('code', state)).rejects.toBeInstanceOf(ValidationError);
  });

  it('stores tokens encrypted, builds a Drive client, and forgets them on disconnect', async () => {
    const { auth, kv } = service();
    expect(auth.isConnected()).toBe(false);
    expect(auth.driveApi()).toBeNull();
    const state = new URL(auth.createAuthUrl()).searchParams.get('state') ?? '';
    vi.spyOn(OAuth2Client.prototype, 'getToken').mockResolvedValue({ tokens: { refresh_token: 'segredo-refresh' }, res: null } as never);
    const revoke = vi.spyOn(OAuth2Client.prototype, 'revokeToken').mockResolvedValue({} as never);
    await auth.handleCallback('code', state);
    expect(auth.isConnected()).toBe(true);
    expect(JSON.stringify(kv.get('google.tokens'))).not.toContain('segredo-refresh');
    expect(auth.driveApi()).not.toBeNull();
    await auth.disconnect();
    expect(revoke).toHaveBeenCalledWith('segredo-refresh');
    expect(auth.isConnected()).toBe(false);
  });
});

describe('scheduler', () => {
  afterEach(() => vi.useRealTimers());

  it('runs at startup, repeats on the interval and backs off after failures', async () => {
    vi.useFakeTimers();
    const statuses = ['success', 'failed', 'failed', 'success'];
    const run = vi.fn(async () => ({ status: statuses.shift() ?? 'success' }));
    const scheduler = new SyncScheduler({ run } as unknown as SyncService, 60, { info: () => {}, warn: () => {}, error: () => {} });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(3);
    expect(scheduler.nextRunAt()).not.toBeNull();
    scheduler.stop();
    expect(scheduler.nextRunAt()).toBeNull();
  });
});

describe('conflicting sources', () => {
  let world: TestWorld | undefined;
  afterEach(() => {
    world?.container.close();
    world = undefined;
  });

  it('two documents proposing different deadlines for the same activity are both flagged and a conflict opens', async () => {
    world = await createLoadedWorld();
    copyFixture(LATER_DIR, 'Ata_2026-10-03.md', world.driveDir);
    fs.writeFileSync(
      path.join(world.driveDir, 'Ata_2026-10-05.md'),
      '# Ata\nstatus: ativo\ndata_da_reuniao: 2026-10-05\n\n- `ACT-101`: Ana entregará a versão de aprovação até 2026-10-09.\n',
    );
    await world.container.sync.run('auto');
    const pending = world.container.suggestionService.list(['pending']).filter((s) => s.targetActivityId === 'ACT-101');
    expect(pending).toHaveLength(2);
    expect(pending.every((s) => s.uncertainties.some((u) => /Conflita com/.test(u)))).toBe(true);
    const conflict = world.container.repos.conflicts.list().find((c) => c.kind === 'conflicting_suggestions');
    expect(conflict?.description).toMatch(/discordam sobre ACT-101/);
    const resolved = world.container.repos.conflicts.resolve(conflict?.id ?? 0, 'Vale a ata mais recente, confirmado com Ana', 'U-B');
    expect(resolved).toMatchObject({ status: 'resolved', resolvedBy: 'U-B' });
    expect(world.container.repos.conflicts.countOpen()).toBe(0);
  });

  it('an edited minutes file whose decision disappears withdraws its pending suggestion', async () => {
    world = await createLoadedWorld();
    const file = copyFixture(LATER_DIR, 'Ata_2026-10-03.md', world.driveDir);
    await world.container.sync.run('auto');
    writeFileBumped(file, '# Ata de reunião de 3 de outubro de 2026\n\nstatus: ativo\n\nReunião cancelada.\n');
    await world.container.sync.run('auto');
    expect(world.container.suggestionService.list(['pending'])).toEqual([]);
    expect(world.container.suggestionService.list(['superseded'])).toHaveLength(1);
  });
});
