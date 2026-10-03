import { useState } from 'react';
import { Link } from 'react-router-dom';
import { todayIso } from '../../shared/dates.ts';
import { ActivityTable } from '../components/ActivityTable.tsx';
import { ErrorState, Loading, RequireMember } from '../components/States.tsx';
import { useMember } from '../member-context.tsx';
import { useActivities, useDigest, useSuggestions } from '../queries.ts';
import { filterActivities } from './ActivitiesPage.tsx';

const WELCOME_KEY = 'lia.welcome.dismissed';

function WelcomeNotice() {
  const [hidden, setHidden] = useState(() => {
    try {
      return window.localStorage.getItem(WELCOME_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      // Convenience only.
    }
  };
  return (
    <div className="notice notice-info">
      <strong>Primeira vez por aqui?</strong>
      Veja <Link to="/comece-aqui">Comece aqui</Link>: propósito, frentes, onde ficam as atividades e sua primeira ação.{' '}
      <button type="button" className="secondary" onClick={dismiss} style={{ marginTop: '0.5rem' }}>
        Entendi, ocultar
      </button>
    </div>
  );
}

export function Overview() {
  return (
    <>
      <WelcomeNotice />
      <RequireMember>
        <OverviewContent />
      </RequireMember>
    </>
  );
}

function OverviewContent() {
  const { member } = useMember();
  const activities = useActivities();
  const pending = useSuggestions('pending');
  const digest = useDigest(member?.id ?? null, 'last_visit');
  if (activities.isLoading) return <Loading />;
  if (activities.isError && !activities.data) return <ErrorState error={activities.error} onRetry={() => void activities.refetch()} />;

  const mine = filterActivities(activities.data ?? [], { owner: member?.id ?? 'all', front: '', status: 'open', due: 'all' });
  const today = todayIso();
  const overdue = mine.filter((a) => a.dueDate !== null && a.dueDate < today).length;
  const blocked = mine.filter((a) => a.status === 'blocked').length;
  const withPending = mine.filter((a) => a.pendingSuggestionIds.length > 0).length;
  const pendingCount = pending.data?.length ?? 0;
  const changes = (digest.data?.confirmed.length ?? 0) + (digest.data?.pending.length ?? 0);

  return (
    <>
      <h1>Olá, {member?.displayName}</h1>
      <p className="lead">O que você precisa fazer agora e o que mudou desde a sua última visita.</p>
      <div className="grid" role="list" aria-label="Resumo">
        <div className="card" role="listitem">
          <div className="stat">{mine.length}</div>
          <Link to="/minhas">atividades abertas suas</Link>
        </div>
        <div className="card" role="listitem">
          <div className="stat">{overdue}</div>
          <span>vencidas</span> · <span>{blocked} bloqueada(s)</span>
        </div>
        <div className="card" role="listitem">
          <div className="stat">{withPending}</div>
          <span>suas com atualização pendente</span>
        </div>
        <div className="card" role="listitem">
          <div className="stat">{pendingCount}</div>
          <Link to="/sugestoes">sugestões para revisar</Link>
          {member?.role === 'reviewer' && pendingCount > 0 && <div className="small">Você pode revisá-las.</div>}
        </div>
      </div>

      <section aria-labelledby="minhas-titulo">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="minhas-titulo">Minhas atividades abertas</h2>
          <Link to="/minhas">Filtrar e ver todas</Link>
        </div>
        {mine.length === 0 ? (
          <p className="card muted">Nenhuma atividade aberta atribuída a você.</p>
        ) : (
          <ActivityTable activities={mine} caption="Minhas atividades abertas, por prazo" />
        )}
      </section>

      <section className="card card-accent" aria-labelledby="mudou-titulo" style={{ marginTop: '1rem' }}>
        <h2 id="mudou-titulo">Mudanças desde a sua última visita</h2>
        {digest.isLoading && <Loading />}
        {digest.data &&
          (digest.data.nothingChanged ? (
            <p>Nada mudou nas suas atividades.</p>
          ) : (
            <p>
              {digest.data.confirmed.length} mudança(s) confirmada(s) e {digest.data.pending.length} proposta(s) pendente(s) que afetam você
              {changes > 0 && (
                <>
                  {' '}
                  — <Link to="/novidades">ver detalhes e fontes</Link>
                </>
              )}
              .
            </p>
          ))}
      </section>
    </>
  );
}
