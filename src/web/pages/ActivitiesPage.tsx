import { useId } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addDaysIso, todayIso } from '../../shared/dates.ts';
import { ACTIVITY_STATUS_LABELS, ACTIVITY_STATUSES, type Activity, type ActivityStatus } from '../../shared/domain.ts';
import { ActivityTable } from '../components/ActivityTable.tsx';
import { EmptyState, ErrorState, Loading, RequireMember } from '../components/States.tsx';
import { useMember } from '../member-context.tsx';
import { useActivities } from '../queries.ts';

export interface ActivityFilters {
  owner: string;
  front: string;
  status: 'open' | 'all' | ActivityStatus;
  due: 'all' | 'overdue' | 'week' | 'none';
}

const DEFAULT_FILTERS: ActivityFilters = { owner: 'all', front: '', status: 'open', due: 'all' };

/** Pure filtering + ordering (soonest deadline first, undated last). */
export function filterActivities(activities: Activity[], filters: ActivityFilters, today: string = todayIso()): Activity[] {
  const weekEnd = addDaysIso(today, 7);
  return activities
    .filter((a) => filters.owner === 'all' || a.ownerIds.includes(filters.owner))
    .filter((a) => !filters.front || a.front === filters.front)
    .filter((a) => (filters.status === 'all' ? true : filters.status === 'open' ? a.status !== 'done' : a.status === filters.status))
    .filter((a) => {
      if (filters.due === 'overdue') return a.dueDate !== null && a.dueDate < today && a.status !== 'done';
      if (filters.due === 'week') return a.dueDate !== null && a.dueDate >= today && a.dueDate <= weekEnd;
      if (filters.due === 'none') return a.dueDate === null;
      return true;
    })
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.id.localeCompare(b.id));
}

export function ActivitiesPage({ mode }: { mode: 'mine' | 'all' }) {
  const content = <ActivitiesContent mode={mode} />;
  return mode === 'mine' ? <RequireMember>{content}</RequireMember> : content;
}

function ActivitiesContent({ mode }: { mode: 'mine' | 'all' }) {
  const { member, members } = useMember();
  const query = useActivities();
  const [params, setParams] = useSearchParams();
  const id = useId();
  const filters: ActivityFilters = {
    owner: mode === 'mine' ? (member?.id ?? 'all') : (params.get('responsavel') ?? DEFAULT_FILTERS.owner),
    front: params.get('frente') ?? DEFAULT_FILTERS.front,
    status: (params.get('estado') as ActivityFilters['status']) ?? DEFAULT_FILTERS.status,
    due: (params.get('prazo') as ActivityFilters['due']) ?? DEFAULT_FILTERS.due,
  };
  const update = (key: string, value: string, fallback: string) => {
    const next = new URLSearchParams(params);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  if (query.isLoading) return <Loading label="Carregando atividades…" />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const all = query.data ?? [];
  const fronts = [...new Set(all.map((a) => a.front))].sort();
  const visible = filterActivities(all, filters);
  const title = mode === 'mine' ? 'Minhas atividades' : 'Todas as atividades';

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <p className="lead">
            {mode === 'mine'
              ? `Atividades em que ${member?.displayName} é responsável, inclusive as compartilhadas.`
              : 'Registro oficial de atividades da Liga, com responsável, prazo, estado e fonte.'}
          </p>
        </div>
        <Link className="button" to="/atividades/nova">
          + Nova atividade
        </Link>
      </div>
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      <section className="card" aria-label="Filtros">
        <div className="filters">
          {mode === 'all' && (
            <div>
              <label htmlFor={`${id}-owner`}>Responsável</label>
              <select id={`${id}-owner`} value={filters.owner} onChange={(e) => update('responsavel', e.target.value, 'all')}>
                <option value="all">Todos</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor={`${id}-front`}>Frente</label>
            <select id={`${id}-front`} value={filters.front} onChange={(e) => update('frente', e.target.value, '')}>
              <option value="">Todas</option>
              {fronts.map((front) => (
                <option key={front} value={front}>
                  {front}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-status`}>Estado</label>
            <select id={`${id}-status`} value={filters.status} onChange={(e) => update('estado', e.target.value, 'open')}>
              <option value="open">Abertas (não concluídas)</option>
              <option value="all">Todas, inclusive concluídas</option>
              {ACTIVITY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {ACTIVITY_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-due`}>Prazo</label>
            <select id={`${id}-due`} value={filters.due} onChange={(e) => update('prazo', e.target.value, 'all')}>
              <option value="all">Qualquer prazo</option>
              <option value="overdue">Vencidas</option>
              <option value="week">Próximos 7 dias</option>
              <option value="none">Sem prazo definido</option>
            </select>
          </div>
        </div>
      </section>
      <p className="muted small" role="status" aria-live="polite">
        {visible.length} de {all.length} atividade(s) exibida(s), ordenadas por prazo.
      </p>
      {visible.length === 0 ? (
        <EmptyState title="Nenhuma atividade com esses filtros">
          {all.length === 0 ? 'Ainda não há atividades: sincronize a pasta do Drive ou crie uma nova.' : 'Tente outro filtro.'}
        </EmptyState>
      ) : (
        <ActivityTable activities={visible} caption={title} />
      )}
    </>
  );
}
