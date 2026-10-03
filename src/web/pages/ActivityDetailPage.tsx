import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, useParams } from 'react-router-dom';
import { formatDateTime } from '../../shared/dates.ts';
import type { ActivityDetail, ActivityEvent, ActivityRef, ActivityStatus } from '../../shared/domain.ts';
import { ActivityForm, type ActivityFormValues } from '../components/ActivityForm.tsx';
import { ActivityStatusBadge, DueDate, PendingUpdateBadge } from '../components/Badges.tsx';
import { SourceLink } from '../components/SourceLink.tsx';
import { ErrorState, Loading } from '../components/States.tsx';
import { fieldLabel, fieldValueText, ownersText } from '../format.ts';
import { useMember } from '../member-context.tsx';
import { useActivities, useActivity, useUpdateActivity } from '../queries.ts';

const EVENT_LABELS: Record<ActivityEvent['kind'], string> = {
  imported: 'Importada do registro',
  created: 'Criada',
  updated: 'Editada',
  suggestion_applied: 'Atualizada por sugestão aprovada',
};

const RELATION_LABELS: Record<ActivityRef['relationType'], string> = {
  imported_from: 'Registro de origem',
  created_by: 'Criada a partir de',
  updated_by: 'Atualizada a partir de',
};

export function ActivityDetailPage() {
  const { id = '' } = useParams();
  const query = useActivity(id);
  if (query.isLoading) return <Loading label="Carregando atividade…" />;
  if (!query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <ActivityDetailView activity={query.data} />;
}

function ActivityDetailView({ activity }: { activity: ActivityDetail }) {
  const { member, memberNames } = useMember();
  const update = useUpdateActivity(activity.id);
  const all = useActivities();
  /** Version the edit form was opened on: saving over a newer version is refused by the server. */
  const [editVersion, setEditVersion] = useState<number | null>(null);
  const editing = editVersion !== null;
  const setEditing = (open: boolean) => setEditVersion(open ? activity.version : null);
  const fronts = [...new Set((all.data ?? []).map((a) => a.front))];
  const error = update.error instanceof Error ? update.error.message : null;

  const changeStatus = (status: ActivityStatus, reason: string) => update.mutate({ status, reason, expectedVersion: activity.version });
  const save = ({ reason, ...fields }: ActivityFormValues) =>
    update.mutate(
      { ...fields, reason: reason || undefined, expectedVersion: editVersion ?? activity.version },
      { onSuccess: () => setEditing(false) },
    );

  return (
    <>
      <p className="small">
        <Link to="/atividades">← Todas as atividades</Link>
      </p>
      <div className="page-header">
        <div>
          <p className="muted" style={{ margin: 0 }}>
            {activity.id} · {activity.front}
          </p>
          <h1>{activity.title}</h1>
          <div className="row">
            <ActivityStatusBadge status={activity.status} />
            {activity.pendingSuggestionIds.length > 0 && <PendingUpdateBadge />}
          </div>
        </div>
        {member && !editing && (
          <div className="row">
            <button type="button" className="secondary" onClick={() => setEditing(true)}>
              Editar
            </button>
            {activity.status !== 'done' && (
              <button type="button" onClick={() => changeStatus('done', 'Marcada como concluída')} disabled={update.isPending}>
                Concluir
              </button>
            )}
            {activity.status === 'blocked' ? (
              <button type="button" className="secondary" onClick={() => changeStatus('in_progress', 'Desbloqueada')} disabled={update.isPending}>
                Desbloquear
              </button>
            ) : (
              activity.status !== 'done' && (
                <button type="button" className="danger" onClick={() => changeStatus('blocked', 'Marcada como bloqueada')} disabled={update.isPending}>
                  Bloquear
                </button>
              )
            )}
          </div>
        )}
      </div>
      {!member && <p className="notice notice-info">Escolha um perfil no topo para editar esta atividade.</p>}
      <div role="status" aria-live="polite">
        {error && !editing && <div className="notice notice-error">{error}</div>}
        {update.isSuccess && !editing && <div className="notice notice-ok">Alteração salva e registrada no histórico.</div>}
      </div>

      {activity.pendingSuggestionIds.length > 0 && (
        <div className="notice notice-warn">
          <strong>Há atualização proposta por documento, ainda não aprovada.</strong>
          Os valores abaixo continuam sendo os oficiais até a revisão. <Link to="/sugestoes">Ver sugestão para revisar</Link>
        </div>
      )}

      {editing ? (
        <section className="card" aria-label="Editar atividade">
          <h2>Editar atividade</h2>
          <ActivityForm
            initial={activity}
            fronts={fronts}
            submitLabel="Salvar alterações"
            busy={update.isPending}
            serverError={error}
            askReason
            onSubmit={save}
            onCancel={() => setEditing(false)}
          />
        </section>
      ) : (
        <section className="card" aria-label="Dados da atividade">
          <dl className="form-grid">
            <div>
              <dt className="muted small">Responsáveis</dt>
              <dd style={{ margin: 0 }}>{ownersText(activity.ownerIds, memberNames, activity.unresolvedOwners)}</dd>
            </div>
            <div>
              <dt className="muted small">Prazo</dt>
              <dd style={{ margin: 0 }}>
                <DueDate dueDate={activity.dueDate} status={activity.status} />
              </dd>
            </div>
            <div>
              <dt className="muted small">Próximo passo</dt>
              <dd style={{ margin: 0 }}>{activity.nextStep || 'Não definido'}</dd>
            </div>
            <div>
              <dt className="muted small">Última atualização</dt>
              <dd style={{ margin: 0 }}>{formatDateTime(activity.updatedAt)}</dd>
            </div>
          </dl>
          {activity.description && <p style={{ marginTop: '1rem' }}>{activity.description}</p>}
          {activity.notes && <p className="small muted">Notas do registro: {activity.notes}</p>}
        </section>
      )}

      <section className="card" aria-labelledby="fontes">
        <h2 id="fontes">Fontes</h2>
        {activity.refs.length === 0 ? (
          <p className="muted">Criada na interface, sem documento de origem.</p>
        ) : (
          <ul className="stack" style={{ paddingLeft: '1.1rem' }}>
            {activity.refs.map((ref, index) => (
              <li key={`${ref.source.fileId}-${index}`}>
                <strong>{RELATION_LABELS[ref.relationType]}:</strong> <SourceLink source={ref.source} /> · {ref.location}
                <blockquote className="evidence small">
                  <ReactMarkdown skipHtml allowedElements={['p', 'strong', 'em', 'code']} unwrapDisallowed>
                    {ref.quote}
                  </ReactMarkdown>
                </blockquote>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="historico">
        <h2 id="historico">Histórico de alterações</h2>
        <ol className="timeline">
          {activity.events.map((event) => (
            <li key={event.id}>
              <strong>{EVENT_LABELS[event.kind]}</strong> · {formatDateTime(event.timestamp)} · por {event.actorName}
              {event.reason && <div className="small muted">{event.reason}</div>}
              {event.kind !== 'imported' && event.changes.length > 0 && (
                <ul className="changes small">
                  {event.changes.map((change) => (
                    <li key={change.field}>
                      {fieldLabel(change.field)}: {fieldValueText(change.field, change.before, memberNames)} →{' '}
                      <strong>{fieldValueText(change.field, change.after, memberNames)}</strong>
                    </li>
                  ))}
                </ul>
              )}
              {event.source && (
                <div className="small">
                  Fonte: <SourceLink source={event.source} />
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
