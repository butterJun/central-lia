import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Source, SyncStatus } from '../../shared/domain.ts';
import type { Container } from '../container.ts';
import { LocalFolderGateway } from '../drive/local-drive.ts';
import { errorMessage, NotFoundError, ValidationError } from '../lib/errors.ts';
import type { SourceRecord } from '../repositories/sources-repo.ts';
import { parseWith } from './app.ts';

const RUNS_LIMIT = 20;
const STALE_GRACE_MS = 60_000;
const TEXT_PREVIEW_TYPES: Record<string, string> = {
  '.md': 'text/plain; charset=utf-8',
  '.markdown': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.gdoc': 'text/plain; charset=utf-8',
};

export function buildSyncStatus(container: Container): SyncStatus {
  const { config, repos, sync, scheduler, gateway, registryImporter } = container;
  const lastRun = repos.syncRuns.latest();
  const lastSuccessAt = repos.syncRuns.lastSuccessAt();
  const staleAfterMs = config.syncIntervalSeconds * 2000 + STALE_GRACE_MS;
  const connected = gateway.isConnected();
  const folder =
    sync.folder() ??
    (config.google
      ? { id: config.google.folderId, name: config.google.folderId, webUrl: `https://drive.google.com/drive/folders/${config.google.folderId}` }
      : null);
  return {
    mode: gateway.mode,
    connected,
    needsAuth: gateway.mode === 'google' && !connected,
    folder,
    intervalSeconds: config.syncIntervalSeconds,
    running: sync.isRunning(),
    lastRun,
    lastSuccessAt,
    nextRunAt: scheduler.nextRunAt(),
    stale: !lastSuccessAt || lastRun?.status === 'failed' || Date.now() - Date.parse(lastSuccessAt) > staleAfterMs,
    counts: repos.sources.counts(),
    registry: registryImporter.info(),
    ai: { provider: config.ai.provider, model: config.ai.provider === 'claude' ? config.ai.model : null, detail: config.ai.reason },
    openConflicts: repos.conflicts.countOpen(),
  };
}

function toSource(record: SourceRecord): Source {
  const { contentHash: _hash, firstSeenAt: _firstSeen, ...source } = record;
  return source;
}

export function registerSyncRoutes(app: FastifyInstance, container: Container): void {
  const { repos, sync, auth } = container;

  app.get('/api/sync/status', async () => buildSyncStatus(container));

  /** Manual trigger for demos and debugging; the scheduler keeps running independently. */
  app.post('/api/sync/run', async () => {
    await sync.run('manual');
    return buildSyncStatus(container);
  });

  app.get('/api/sync/runs', async () => repos.syncRuns.list(RUNS_LIMIT));
  app.get('/api/sources', async () => repos.sources.list().map(toSource));

  app.get('/auth/google/start', async (_request, reply) => {
    if (!auth) throw new ValidationError('A aplicação está no modo pasta local; configure DRIVE_MODE=google (veja o README).');
    return reply.redirect(auth.createAuthUrl());
  });

  app.get('/auth/google/callback', async (request, reply) => {
    if (!auth) throw new NotFoundError('Modo Google não configurado');
    const query = request.query as { code?: string; state?: string; error?: string };
    if (query.error) return reply.redirect(`/sincronizacao?erro=${encodeURIComponent('Acesso não autorizado no Google')}`);
    try {
      await auth.handleCallback(query.code, query.state);
    } catch (error) {
      container.logger.warn(`Falha no retorno do OAuth: ${errorMessage(error)}`);
      return reply.redirect(`/sincronizacao?erro=${encodeURIComponent('Não foi possível concluir a conexão com o Google')}`);
    }
    void sync.run('manual');
    return reply.redirect('/sincronizacao?conectado=1');
  });

  app.post('/api/drive/disconnect', async () => {
    if (!auth) throw new ValidationError('Modo pasta local não usa conexão com o Google.');
    await auth.disconnect();
    return buildSyncStatus(container);
  });

  /** Local-folder mode only: opens the original file, playing the role of the Drive link. */
  app.get('/api/local-files/:id', async (request, reply) => {
    const { id } = parseWith(z.object({ id: z.string().regex(/^local-[0-9a-f]+$/) }), request.params);
    const gateway = container.gateway;
    if (!(gateway instanceof LocalFolderGateway)) throw new NotFoundError('Disponível apenas no modo pasta local');
    const absolute = gateway.resolvePath(id);
    if (!absolute) throw new NotFoundError('Arquivo não encontrado na pasta local (sincronize de novo)');
    const extension = path.extname(absolute).toLowerCase();
    const type = TEXT_PREVIEW_TYPES[extension];
    const content = await fs.readFile(absolute).catch(() => {
      throw new NotFoundError('Arquivo removido da pasta local');
    });
    if (type) return reply.type(type).send(content);
    return reply
      .header('content-disposition', `attachment; filename="${encodeURIComponent(path.basename(absolute))}"`)
      .type('application/octet-stream')
      .send(content);
  });
}
