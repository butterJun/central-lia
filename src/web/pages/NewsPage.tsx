import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDateTime } from '../../shared/dates.ts';
import { SOURCE_ROLE_LABELS, type ActivitySummary, type Digest } from '../../shared/domain.ts';
import type { DigestPeriod } from '../../shared/schemas.ts';
import { ActivityStatusBadge, DueDate, SourceStatusBadge } from '../components/Badges.tsx';
import { SourceLink } from '../components/SourceLink.tsx';
import { ErrorState, Loading, RequireMember } from '../components/States.tsx';
import { fieldLabel, fieldValueText } from '../format.ts';
import { useMember } from '../member-context.tsx';
import { useDigest, useNarrative, useSources } from '../queries.ts';

const PERIODS: Array<{ value: DigestPeriod; label: string }> = [
  { value: 'last_visit', label: 'Desde a minha última visita' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: 'all', label: 'Desde o início' },
];

export function NewsPage() {
  return (
    <>
      <h1>Novidades dos documentos</h1>
      <p className="lead">O que mudou para você, separado entre fatos confirmados, propostas ainda não aprovadas e dados incertos.</p>
      <RequireMember>
        <PersonalDigest />
      </RequireMember>
      <RecentDocuments />
    </>
  );
}

function PersonalDigest() {
  const { member, memberNames } = useMember();
  const [period, setPeriod] = useState<DigestPeriod>('last_visit');
  const digestQuery = useDigest(member?.id ?? null, period);
  const narrative = useNarrative(period);
  const id = useId();
  const digest = digestQuery.data;

  return (
    <section className="card card-accent" aria-labelledby={`${id}-title`}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <h2 id={`${id}-title`}>O que mudou para {member?.displayName}</h2>
        <div>
          <label htmlFor={`${id}-period`}>Período</label>
          <select id={`${id}-period`} value={period} onChange={(e) => setPeriod(e.target.value as DigestPeriod)}>
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {digestQuery.isLoading && <Loading />}
      {digestQuery.isError && <ErrorState error={digestQuery.error} onRetry={() => void digestQuery.refetch()} />}
      {digest && (
        <>
          <p className="small muted">
            Considerando registros desde {digest.since.startsWith('1970') ? 'o início' : formatDateTime(digest.since)}.
          </p>
          {digest.nothingChanged && <p className="notice notice-info">Nada mudou nas suas atividades neste período.</p>}
          <div className="grid">
            <ConfirmedList digest={digest} names={memberNames} />
            <PendingList digest={digest} />
          </div>
          <AttentionList digest={digest} />
          {digest.uncertain.length > 0 && (
            <div className="notice notice-warn">
              <strong>Dados incertos ou em conflito</strong>
              <ul>
                {digest.uncertain.map((note, index) => (
                  <li key={index}>
                    {note.text} {note.source && <SourceLink source={note.source} label="(fonte)" />}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="row">
            <button type="button" className="accent" onClick={() => narrative.mutate()} disabled={narrative.isPending}>
              {narrative.isPending ? 'Escrevendo resumo…' : 'Resumir em texto'}
            </button>
          </div>
          <div role="status" aria-live="polite">
            {narrative.data && (
              <div className="card" style={{ marginTop: '0.75rem' }}>
                <p style={{ fontFamily: 'var(--font-editorial)', fontSize: '1.05rem' }}>{narrative.data.text}</p>
                <p className="small muted">
                  Texto gerado por {narrative.data.generator} a partir dos registros acima; os itens listados são a referência.
                </p>
                {narrative.data.warning && <p className="small">⚠ {narrative.data.warning}</p>}
              </div>
            )}
            {narrative.isError && <ErrorState error={narrative.error} />}
          </div>
        </>
      )}
    </section>
  );
}

function ConfirmedList({ digest, names }: { digest: Digest; names: ReturnType<typeof useMember>['memberNames'] }) {
  return (
    <div>
      <h3>✓ Confirmado ({digest.confirmed.length})</h3>
      {digest.confirmed.length === 0 ? (
        <p className="muted small">Nenhuma mudança oficial.</p>
      ) : (
        <ul className="small" style={{ paddingLeft: '1.1rem' }}>
          {digest.confirmed.map((change, index) => (
            <li key={index}>
              <Link to={`/atividades/${change.activityId}`}>{change.activityId}</Link> {change.activityTitle} — {change.reason ?? change.kind} (
              {change.actorName}, {formatDateTime(change.timestamp)})
              {change.kind !== 'imported' && (
                <ul>
                  {change.changes.map((c) => (
                    <li key={c.field}>
                      {fieldLabel(c.field)}: {fieldValueText(c.field, c.before, names)} → <strong>{fieldValueText(c.field, c.after, names)}</strong>
                    </li>
                  ))}
                </ul>
              )}
              {change.source && (
                <div>
                  Fonte: <SourceLink source={change.source} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PendingList({ digest }: { digest: Digest }) {
  return (
    <div>
      <h3>… Proposto, ainda não oficial ({digest.pending.length})</h3>
      {digest.pending.length === 0 ? (
        <p className="muted small">Nenhuma proposta pendente que afete você.</p>
      ) : (
        <ul className="small" style={{ paddingLeft: '1.1rem' }}>
          {digest.pending.map((suggestion) => (
            <li key={suggestion.id}>
              {suggestion.kind === 'update' ? `Atualizar ${suggestion.targetActivityId}` : `Nova atividade: ${suggestion.proposed.title}`} —
              fonte <SourceLink source={suggestion.source} />. <Link to="/sugestoes">Revisar</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SummaryItems({ title, items }: { title: string; items: ActivitySummary[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3>{title}</h3>
      <ul className="small" style={{ paddingLeft: '1.1rem' }}>
        {items.map((item) => (
          <li key={item.id}>
            <Link to={`/atividades/${item.id}`}>{item.id}</Link> {item.title} · <DueDate dueDate={item.dueDate} status={item.status} />{' '}
            <ActivityStatusBadge status={item.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AttentionList({ digest }: { digest: Digest }) {
  if (digest.overdue.length + digest.dueSoon.length + digest.blocked.length === 0) return null;
  return (
    <div className="grid">
      <SummaryItems title="⚠ Vencidas" items={digest.overdue} />
      <SummaryItems title="⏰ Vencem em até 3 dias" items={digest.dueSoon} />
      <SummaryItems title="⛔ Bloqueadas" items={digest.blocked} />
    </div>
  );
}

function RecentDocuments() {
  const query = useSources();
  const recent = [...(query.data ?? [])]
    .filter((source) => source.lastProcessedAt || source.syncStatus === 'unavailable')
    .sort((a, b) => (b.lastProcessedAt ?? b.lastSeenAt).localeCompare(a.lastProcessedAt ?? a.lastSeenAt))
    .slice(0, 12);
  return (
    <section aria-labelledby="docs-recentes">
      <h2 id="docs-recentes" style={{ marginTop: '1.5rem' }}>
        Documentos recentes da pasta
      </h2>
      {query.isLoading && <Loading />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {recent.map((source) => (
        <article key={source.fileId} className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>
              <SourceLink source={source} />
            </h3>
            <SourceStatusBadge status={source.syncStatus} />
          </div>
          <p className="small muted">
            {source.kindLabel} · {SOURCE_ROLE_LABELS[source.role]} · lido em {formatDateTime(source.lastProcessedAt)}
          </p>
          {source.statusDetail && <p className="small">{source.statusDetail}</p>}
          {source.analysis && (
            <div className="small">
              <p>
                Análise ({source.analysis.generator}): {source.analysis.suggestionsCreated} sugestão(ões) nova(s).{' '}
                {source.analysis.suggestionsCreated > 0 && <Link to="/sugestoes">Revisar</Link>}
              </p>
              {source.analysis.ignored.length > 0 && (
                <details>
                  <summary>Trechos que não viraram atividade ({source.analysis.ignored.length})</summary>
                  <ul>
                    {source.analysis.ignored.map((item, index) => (
                      <li key={index}>
                        “{item.text}” — <em>{item.reason}</em>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {source.analysis.warnings.map((warning) => (
                <p key={warning}>⚠ {warning}</p>
              ))}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
