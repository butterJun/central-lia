import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalFolderGateway } from '../src/server/drive/local-drive.ts';
import { DriveAuthError, DriveFileAccessError, type DriveFile } from '../src/server/drive/types.ts';
import { SyncScheduler } from '../src/server/sync/scheduler.ts';
import {
  CONFLICT_DIR,
  LATER_DIR,
  REGISTRY_HEADERS,
  copyFixture,
  createLoadedWorld,
  createTestWorld,
  makeXlsx,
  registryRow,
  writeFileBumped,
  type TestWorld,
} from './helpers.ts';

let world: TestWorld | undefined;
afterEach(() => {
  world?.container.close();
  world = undefined;
});

function sourceByName(name: string) {
  return world?.container.repos.sources.list().find((source) => source.name === name);
}

function mine(memberId: string): string[] {
  return (world?.container.activityService.list() ?? []).filter((a) => a.ownerIds.includes(memberId)).map((a) => a.id);
}

describe('initial load', () => {
  it('processes every required format, assigns roles and imports the registry indicated by INDEX.md', async () => {
    world = await createLoadedWorld();
    const run = world.container.repos.syncRuns.latest();
    expect(run?.status).toBe('success');
    expect(run?.stats).toMatchObject({ listed: 6, processed: 6, failed: 0 });
    expect(sourceByName('Ata_registro.xlsx')?.role).toBe('registry');
    expect(sourceByName('INDEX.md')?.role).toBe('direction');
    expect(sourceByName('PLANO_EDITORIAL_ANTIGO.md')?.role).toBe('historical');
    expect(sourceByName('Ata_2026-10-01.md')?.role).toBe('minutes');
    expect(world.container.registryImporter.info()).toMatchObject({ sheet: 'Atividades', pointerFrom: 'INDEX.md' });
  });

  it('gives each demo member the expected activities, preserving the shared and the blocked ones', async () => {
    world = await createLoadedWorld();
    expect(mine('U-A')).toEqual(['ACT-101', 'ACT-104']);
    expect(mine('U-D')).toEqual(['ACT-102', 'ACT-104']);
    expect(mine('U-C')).toEqual(['ACT-103']);
    const act103 = world.container.activityService.detail('ACT-103');
    expect(act103.status).toBe('blocked');
    expect(act103.dueDate).toBe('2026-10-09');
    expect(act103.events[0]).toMatchObject({ kind: 'imported', actorId: 'system' });
    expect(act103.refs.map((ref) => ref.relationType)).toEqual(['imported_from', 'created_by']);
    expect(world.container.suggestionService.list()).toEqual([]);
  });

  it('is idempotent: a second pass reads nothing again and creates nothing', async () => {
    world = await createLoadedWorld();
    const run = await world.container.sync.run('auto');
    expect(run.stats).toMatchObject({ unchanged: 6, processed: 0, suggestionsCreated: 0 });
    expect(world.container.activityService.list()).toHaveLength(4);
  });
});

describe('incremental detection', () => {
  it('detects new minutes added to the folder and proposes, without applying, the ACT-101 deadline change', async () => {
    world = await createLoadedWorld();
    copyFixture(LATER_DIR, 'Ata_2026-10-03.md', world.driveDir);
    const run = await world.container.sync.run('auto');
    expect(run.stats?.suggestionsCreated).toBe(1);
    const [suggestion] = world.container.suggestionService.list(['pending']);
    expect(suggestion).toMatchObject({ kind: 'update', targetActivityId: 'ACT-101', proposed: { dueDate: '2026-10-07' } });
    const act101 = world.container.activityService.detail('ACT-101');
    expect(act101.dueDate).toBe('2026-10-05');
    expect(act101.pendingSuggestionIds).toEqual([suggestion?.id]);
    expect(world.container.activityService.list()).toHaveLength(4);
  });

  it('reads files inside subfolders and native Google Docs', async () => {
    world = await createLoadedWorld();
    const sub = path.join(world.driveDir, 'Atas 2026');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'Ata nova.gdoc'), '# Ata\nstatus: ativo\ndata_da_reuniao: 2026-10-05\n\nACT-102: Davi entregará o checklist até 2026-10-08.\n');
    await world.container.sync.run('auto');
    expect(sourceByName('Ata nova.gdoc')).toMatchObject({ path: '/Atas 2026', syncStatus: 'processed', kindLabel: 'Google Docs' });
    expect(world.container.suggestionService.list(['pending'])[0]?.proposed.dueDate).toBe('2026-10-08');
  });

  it('keeps the idea out of the board and marks the .docx as not processed', async () => {
    world = await createLoadedWorld();
    copyFixture(LATER_DIR, 'Ata_2026-10-04.md', world.driveDir);
    copyFixture(LATER_DIR, 'Ata_2026-10-03.docx', world.driveDir);
    await world.container.sync.run('auto');
    const pending = world.container.suggestionService.list(['pending']);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: 'create', proposed: { ownerIds: ['U-C'], dueDate: '2026-10-10' } });
    expect(sourceByName('Ata_2026-10-04.md')?.analysis?.ignored[0]?.text).toMatch(/Talvez/);
    expect(sourceByName('Ata_2026-10-03.docx')).toMatchObject({ syncStatus: 'unsupported', statusDetail: expect.stringMatching(/Google Docs/) });
  });

  it('re-reads an edited document without duplicating it and supersedes suggestions the new text no longer supports', async () => {
    world = await createLoadedWorld();
    const file = copyFixture(LATER_DIR, 'Ata_2026-10-04.md', world.driveDir);
    await world.container.sync.run('auto');
    const [first] = world.container.suggestionService.list(['pending']);
    writeFileBumped(file, fs.readFileSync(file, 'utf8').replace('2026-10-10', '2026-10-12'));
    await world.container.sync.run('auto');
    expect(world.container.repos.sources.list().filter((s) => s.name === 'Ata_2026-10-04.md')).toHaveLength(1);
    expect(world.container.suggestionService.get(first?.id ?? '').status).toBe('superseded');
    const pending = world.container.suggestionService.list(['pending']);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.proposed.dueDate).toBe('2026-10-12');
  });

  it('does not re-analyze a new Drive version whose text is identical', async () => {
    world = await createLoadedWorld();
    const file = copyFixture(LATER_DIR, 'Ata_2026-10-03.md', world.driveDir);
    await world.container.sync.run('auto');
    writeFileBumped(file, fs.readFileSync(file));
    const run = await world.container.sync.run('auto');
    expect(run.stats?.processed).toBe(1);
    expect(world.container.suggestionService.list()).toHaveLength(1);
  });

  it('marks removed files as unavailable and withdraws their pending suggestions', async () => {
    world = await createLoadedWorld();
    const file = copyFixture(LATER_DIR, 'Ata_2026-10-03.md', world.driveDir);
    await world.container.sync.run('auto');
    fs.unlinkSync(file);
    const run = await world.container.sync.run('auto');
    expect(run.stats?.unavailable).toBe(1);
    expect(sourceByName('Ata_2026-10-03.md')?.syncStatus).toBe('unavailable');
    expect(world.container.repos.sources.getContent(sourceByName('Ata_2026-10-03.md')?.fileId ?? '')).toBeNull();
    expect(world.container.suggestionService.list(['pending'])).toEqual([]);
  });
});

describe('authority and conflicts', () => {
  it('an empty look-alike spreadsheet does not erase activities and opens a visible conflict', async () => {
    world = await createLoadedWorld();
    copyFixture(CONFLICT_DIR, 'Ata - copia vazia.xlsx', world.driveDir);
    await world.container.sync.run('auto');
    expect(world.container.activityService.list()).toHaveLength(4);
    expect(sourceByName('Ata - copia vazia.xlsx')?.role).toBe('shadow_registry');
    const conflicts = world.container.repos.conflicts.list();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'shadow_registry', status: 'open', description: expect.stringMatching(/Está vazia/) });
  });

  it('turns later edits of the registry spreadsheet into suggestions instead of overwriting the official data', async () => {
    world = await createLoadedWorld();
    const rows = [
      registryRow('ACT-101', 'Preparar carrossel sobre ferramentas', 'Ana', '2026-10-05', 'Growth', 'Em andamento', 'Preparar roteiro e selecionar exemplos'),
      registryRow('ACT-102', 'Montar checklist inicial de onboarding', 'Davi', '2026-10-08', 'Operações', 'A fazer', 'Revisar material de entrada e propor primeira versão'),
      registryRow('ACT-103', 'Elaborar briefing de oficina', 'Carla', '2026-10-09', 'Formação', 'Bloqueada', 'Obter confirmação do espaço'),
      registryRow('ACT-105', 'Organizar arquivo de fotos', 'Davi', '2026-10-15', 'Operações', 'A fazer', 'Criar pastas'),
    ];
    writeFileBumped(path.join(world.driveDir, 'Ata_registro.xlsx'), await makeXlsx('Atividades', REGISTRY_HEADERS, rows));
    await world.container.sync.run('auto');
    const pending = world.container.suggestionService.list(['pending']);
    expect(pending.map((s) => `${s.kind}:${s.targetActivityId}`).sort()).toEqual(['create:ACT-105', 'update:ACT-102']);
    expect(pending.find((s) => s.kind === 'update')?.proposed).toEqual({ dueDate: '2026-10-08' });
    expect(world.container.activityService.detail('ACT-102').dueDate).toBe('2026-10-06');
    const removed = world.container.repos.conflicts.list().find((c) => c.kind === 'registry_row_removed');
    expect(removed?.description).toMatch(/ACT-104 não aparece mais/);
    expect(world.container.activityService.list()).toHaveLength(4);
  });

  it('an emptied registry keeps every activity and asks for a human decision', async () => {
    world = await createLoadedWorld();
    writeFileBumped(path.join(world.driveDir, 'Ata_registro.xlsx'), await makeXlsx('Atividades', REGISTRY_HEADERS, []));
    await world.container.sync.run('auto');
    expect(world.container.activityService.list()).toHaveLength(4);
    expect(world.container.repos.conflicts.list()[0]?.kind).toBe('registry_empty');
  });
});

describe('failures', () => {
  class FlakyGateway extends LocalFolderGateway {
    failAuth = false;
    failFile: string | null = null;
    override async listTree(): Promise<DriveFile[]> {
      if (this.failAuth) throw new DriveAuthError('token revogado');
      return super.listTree();
    }
    override async download(file: DriveFile): Promise<Buffer> {
      if (file.name === this.failFile) throw new DriveFileAccessError(`Sem acesso a ${file.name} (HTTP 403)`);
      return super.download(file);
    }
  }

  it('an authorization failure aborts the run but keeps the last confirmed state', async () => {
    let gateway: FlakyGateway | undefined;
    world = createTestWorld((driveDir) => ({ gateway: (gateway = new FlakyGateway(driveDir)) }));
    copyFixture(LATER_DIR, 'Ata_2026-10-03.md', world.driveDir);
    await world.container.sync.run('manual');
    if (gateway) gateway.failAuth = true;
    const run = await world.container.sync.run('auto');
    expect(run).toMatchObject({ status: 'failed', error: 'token revogado' });
    expect(world.container.repos.sources.list()).toHaveLength(1);
    expect(world.container.repos.syncRuns.lastSuccessAt()).not.toBeNull();
  });

  it('a single unreadable file is reported as failed while the others are processed', async () => {
    let gateway: FlakyGateway | undefined;
    world = createTestWorld((driveDir) => ({ gateway: (gateway = new FlakyGateway(driveDir)) }));
    copyFixture(LATER_DIR, 'Ata_2026-10-03.md', world.driveDir);
    copyFixture(LATER_DIR, 'Ata_2026-10-04.md', world.driveDir);
    if (gateway) gateway.failFile = 'Ata_2026-10-04.md';
    const run = await world.container.sync.run('manual');
    expect(run.status).toBe('partial');
    expect(sourceByName('Ata_2026-10-04.md')).toMatchObject({ syncStatus: 'failed', statusDetail: expect.stringMatching(/403/) });
    expect(sourceByName('Ata_2026-10-03.md')?.syncStatus).toBe('processed');
  });

  it('concurrent sync requests share one run', async () => {
    world = await createLoadedWorld();
    const [a, b] = await Promise.all([world.container.sync.run('manual'), world.container.sync.run('auto')]);
    expect(a.id).toBe(b.id);
  });

  it('backs off exponentially after failures but never beyond 10 minutes', () => {
    expect(SyncScheduler.delaySeconds(120, 0)).toBe(120);
    expect(SyncScheduler.delaySeconds(120, 1)).toBe(240);
    expect(SyncScheduler.delaySeconds(120, 5)).toBe(600);
  });
});
