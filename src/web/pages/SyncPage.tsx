import { useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDateTime } from '../../shared/dates.ts';
import { SOURCE_ROLE_LABELS, type Conflict, type SyncStatus } from '../../shared/domain.ts';
import { SourceStatusBadge } from '../components/Badges.tsx';
import { SourceLink } from '../components/SourceLink.tsx';
import { ErrorState, Loading } from '../components/States.tsx';
import { useMember } from '../member-context.tsx';
import { useConflicts, useDisconnectDrive, useResolveConflict, useRunSync, useSources, useSyncRuns, useSyncStatus } from '../queries.ts';

const RUN_STATUS: Record<string, string> = { running: 'Em andamento', success: 'Concluída', partial: 'Concluída com falhas', failed: 'Falhou' };
const TRIGGER: Record<string, string> = { auto: 'automática', manual: 'manual', startup: 'ao iniciar' };

export function SyncPage() {
  const status = useSyncStatus();
  const [params] = useSearchParams();
  return (
    <>
      <h1>Estado da sincronização</h1>
      <p className="lead">Qual pasta do Drive está conectada, quando foi lida pela última vez e o estado de cada arquivo.</p>
      {params.get('conectado') && <p className="notice notice-ok">Google Drive conectado. A primeira leitura começou.</p>}
      {params.get('erro') && <p className="notice notice-error">{params.get('erro')}</p>}
      {status.isLoading && <Loading />}
      {status.isError && <ErrorState error={status.error} onRetry={() => void status.refetch()} />}
      {status.data && <StatusCard status={status.data} />}
      <ConflictsSection />
      <FilesSection />
      <RunsSection />
    </>
  );
}

function StatusCard({ status }: { status: SyncStatus }) {
  const run = useRunSync();
  const disconnect = useDisconnectDrive();
  const last = status.lastRun;
  return (
    <section className="card card-accent" aria-label="Conexão e última leitura">
      <div className="grid">
        <div>
          <h2>Pasta conectada</h2>
          {status.folder ? (
            <p>
              {status.mode === 'google' ? (
                <a href={status.folder.webUrl} target="_blank" rel="noreferrer noopener">
                  {status.folder.name}
                </a>
              ) : (
                <strong>{status.folder.name}</strong>
              )}{' '}
              e subpastas
            </p>
          ) : (
            <p className="muted">Nenhuma pasta lida ainda.</p>
          )}
          <p className="small muted">
            {status.mode === 'google' ? 'Google Drive (somente leitura, escopo drive.readonly).' : 'Modo demonstração: pasta local simulando o Drive.'}
          </p>
          {status.mode === 'google' &&
            (status.connected ? (
              <button type="button" className="secondary" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
                Desconectar Google Drive
              </button>
            ) : (
              <a className="button" href="/auth/google/start">
                Conectar Google Drive
              </a>
            ))}
        </div>
        <div>
          <h2>Última sincronização</h2>
          {last ? (
            <p>
              {RUN_STATUS[last.status]} ({TRIGGER[last.trigger]}) em {formatDateTime(last.finishedAt ?? last.startedAt)}
              {last.error && <span className="due-overdue"> — {last.error}</span>}
            </p>
          ) : (
            <p className="muted">Ainda não sincronizado.</p>
          )}
          <p className="small">
            Último sucesso: {status.lastSuccessAt ? formatDateTime(status.lastSuccessAt) : 'nenhum'}
            <br />
            Verificação automática a cada {Math.round(status.intervalSeconds / 60)} min
            {status.nextRunAt && ` · próxima às ${formatDateTime(status.nextRunAt)}`}
          </p>
          <button type="button" onClick={() => run.mutate()} disabled={run.isPending || status.running} aria-busy={run.isPending}>
            {run.isPending || status.running ? 'Sincronizando…' : 'Sincronizar agora'}
          </button>
          {run.isError && <ErrorState error={run.error} />}
        </div>
        <div>
          <h2>Arquivos</h2>
          <p className="small">
            ✓ {status.counts.processed} processados · ⚠ {status.counts.failed} com erro · ◇ {status.counts.unsupported} não processados · ✕{' '}
            {status.counts.unavailable} indisponíveis
          </p>
          <h2>IA</h2>
          <p className="small">{status.ai.detail}</p>
        </div>
      </div>
      {status.registry && (
        <div className="notice notice-info" style={{ marginTop: '1rem', marginBottom: 0 }}>
          <strong>Fonte oficial das atividades</strong>
          Importadas de <SourceLink source={status.registry.source} /> (aba {status.registry.sheet}, indicada em {status.registry.pointerFrom}) em{' '}
          {formatDateTime(status.registry.importedAt)}. Desde então, o registro oficial é esta aplicação: edições na interface valem; edições
          posteriores na planilha e atas novas viram sugestões para revisão.
        </div>
      )}
    </section>
  );
}

function ConflictsSection() {
  const conflicts = useConflicts();
  const open = (conflicts.data ?? []).filter((c) => c.status === 'open');
  const resolved = (conflicts.data ?? []).filter((c) => c.status === 'resolved');
  return (
    <section aria-labelledby="conflitos">
      <h2 id="conflitos">Conflitos e fontes sem autoridade ({open.length} em aberto)</h2>
      {open.length === 0 && <p className="muted">Nenhum conflito em aberto.</p>}
      {open.map((conflict) => (
        <ConflictCard key={conflict.id} conflict={conflict} />
      ))}
      {resolved.length > 0 && (
        <details className="card">
          <summary>Conflitos resolvidos ({resolved.length})</summary>
          <ul className="small">
            {resolved.map((c) => (
              <li key={c.id}>
                {c.description} — <em>{c.resolution}</em> ({c.resolvedBy}, {formatDateTime(c.resolvedAt)})
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function ConflictCard({ conflict }: { conflict: Conflict }) {
  const { member } = useMember();
  const resolve = useResolveConflict();
  const [resolution, setResolution] = useState('');
  const id = useId();
  return (
    <article className="notice notice-warn">
      <strong>⚠ {conflict.description}</strong>
      {conflict.source && (
        <p className="small">
          Arquivo: <SourceLink source={conflict.source} /> · detectado em {formatDateTime(conflict.createdAt)}
        </p>
      )}
      {member?.role === 'reviewer' ? (
        <div className="row">
          <label htmlFor={id} className="visually-hidden">
            Decisão tomada
          </label>
          <input id={id} placeholder="Decisão tomada (ex.: planilha descartada, fonte vigente mantida)" value={resolution} onChange={(e) => setResolution(e.target.value)} style={{ flex: 1 }} />
          <button type="button" onClick={() => resolve.mutate({ id: conflict.id, resolution })} disabled={resolution.trim().length < 3 || resolve.isPending}>
            Registrar decisão
          </button>
        </div>
      ) : (
        <p className="small">Um perfil revisor precisa registrar a decisão.</p>
      )}
      {resolve.isError && <ErrorState error={resolve.error} />}
    </article>
  );
}

function FilesSection() {
  const sources = useSources();
  return (
    <section aria-labelledby="arquivos" style={{ marginTop: '1.5rem' }}>
      <h2 id="arquivos">Arquivos da pasta</h2>
      {sources.isLoading && <Loading />}
      {sources.isError && <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />}
      {sources.data && (
        <div className="table-wrap">
          <table className="responsive">
            <caption className="visually-hidden">Arquivos e estado de processamento</caption>
            <thead>
              <tr>
                <th scope="col">Arquivo</th>
                <th scope="col">Estado</th>
                <th scope="col">Papel</th>
                <th scope="col">Modificado no Drive</th>
                <th scope="col">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {sources.data.map((source) => (
                <tr key={source.fileId}>
                  <td>
                    <SourceLink source={source} />
                    <div className="small muted">
                      {source.kindLabel} · pasta {source.path} · versão {source.versionOrHash}
                    </div>
                  </td>
                  <td data-label="Estado">
                    <SourceStatusBadge status={source.syncStatus} />
                  </td>
                  <td data-label="Papel" className="small">
                    {SOURCE_ROLE_LABELS[source.role]}
                  </td>
                  <td data-label="Modificado" className="small">
                    {formatDateTime(source.modifiedAt)}
                  </td>
                  <td data-label="Detalhe" className="small">
                    {source.statusDetail ?? (source.lastProcessedAt ? `Lido em ${formatDateTime(source.lastProcessedAt)}` : '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RunsSection() {
  const runs = useSyncRuns();
  return (
    <details className="card" style={{ marginTop: '1.5rem' }}>
      <summary>Histórico de sincronizações</summary>
      <ul className="small">
        {(runs.data ?? []).map((run) => (
          <li key={run.id}>
            {formatDateTime(run.startedAt)} · {TRIGGER[run.trigger]} · {RUN_STATUS[run.status]}
            {run.stats && ` · ${run.stats.listed} listados, ${run.stats.processed} lidos, ${run.stats.failed} com erro, ${run.stats.suggestionsCreated} sugestões`}
            {run.error && ` · ${run.error}`}
          </li>
        ))}
      </ul>
    </details>
  );
}
