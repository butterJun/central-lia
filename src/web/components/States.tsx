import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api.ts';
import { useMember } from '../member-context.tsx';

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <p className="row muted" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Não foi possível carregar os dados.';
  const offline = error instanceof ApiError && error.status === 0;
  return (
    <div className="notice notice-error" role="alert">
      <strong>{offline ? 'Conexão perdida' : 'Algo deu errado'}</strong>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="secondary" onClick={onRetry}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

/** Shown on personal pages until a demo profile is chosen. */
export function RequireMember({ children }: { children: ReactNode }) {
  const { member, members, selectMember, loading } = useMember();
  if (member) return <>{children}</>;
  if (loading) return <Loading />;
  return (
    <div className="card card-accent">
      <h2>Quem é você nesta demonstração?</h2>
      <p className="muted">
        Escolha um perfil de exemplo para ver as atividades e novidades dessa pessoa. Primeira vez? Veja também{' '}
        <Link to="/comece-aqui">Comece aqui</Link>.
      </p>
      <div className="row">
        {members.map((candidate) => (
          <button key={candidate.id} type="button" className="secondary" onClick={() => selectMember(candidate.id)}>
            {candidate.displayName} · {candidate.front}
          </button>
        ))}
      </div>
    </div>
  );
}
