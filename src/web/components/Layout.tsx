import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { formatDateTime } from '../../shared/dates.ts';
import { useMember } from '../member-context.tsx';
import { useSuggestions, useSyncStatus } from '../queries.ts';

const NAV_ITEMS = [
  { to: '/comece-aqui', label: 'Comece aqui' },
  { to: '/minhas', label: 'Minhas atividades' },
  { to: '/atividades', label: 'Todas as atividades' },
  { to: '/sugestoes', label: 'Sugestões para revisar', countsSuggestions: true },
  { to: '/novidades', label: 'Novidades dos documentos' },
  { to: '/sincronizacao', label: 'Estado da sincronização' },
];

function MemberSwitch() {
  const { member, members, selectMember } = useMember();
  return (
    <div className="member-switch">
      <label htmlFor="member-select" style={{ margin: 0 }}>
        Você é
      </label>
      <select id="member-select" value={member?.id ?? ''} onChange={(event) => selectMember(event.target.value)}>
        <option value="" disabled>
          Escolha um perfil de demonstração
        </option>
        {members.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.displayName} — {candidate.front}
            {candidate.role === 'reviewer' ? ' (revisor)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Persistent warning when the Drive data might be outdated or the connection is missing. */
function SyncBanner() {
  const { data: status, isError } = useSyncStatus();
  if (isError) {
    return (
      <div className="notice notice-error" role="alert">
        <strong>Conexão com o servidor perdida.</strong> Mostrando os últimos dados carregados; eles podem estar desatualizados.
      </div>
    );
  }
  if (!status) return null;
  if (status.needsAuth) {
    return (
      <div className="notice notice-warn" role="status">
        <strong>Google Drive não conectado.</strong> As atividades confirmadas continuam disponíveis.{' '}
        <NavLink to="/sincronizacao">Conectar a pasta</NavLink>
      </div>
    );
  }
  if (status.lastRun?.status === 'failed' || status.stale) {
    return (
      <div className="notice notice-warn" role="status">
        <strong>Dados possivelmente desatualizados.</strong>{' '}
        {status.lastSuccessAt ? `Última sincronização bem-sucedida: ${formatDateTime(status.lastSuccessAt)}.` : 'Ainda não houve sincronização bem-sucedida.'}{' '}
        <NavLink to="/sincronizacao">Ver detalhes</NavLink>
      </div>
    );
  }
  return null;
}

export function Layout({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pending = useSuggestions('pending');
  const pendingCount = pending.data?.length ?? 0;
  const { data: status } = useSyncStatus();

  return (
    <>
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="site-header">
        <div className="header-inner">
          <NavLink to="/" className="brand">
            Central da Liga IA
            <small>contexto, onboarding e atividades</small>
          </NavLink>
          <MemberSwitch />
          <button
            type="button"
            className="secondary menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            Menu
          </button>
        </div>
      </header>
      <nav id="main-nav" className="nav" aria-label="Principal" data-open={menuOpen}>
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} onClick={() => setMenuOpen(false)}>
                {item.label}
                {item.countsSuggestions && pendingCount > 0 && (
                  <span className="count" aria-label={`${pendingCount} pendentes`}>
                    {pendingCount}
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main id="conteudo" className="main" tabIndex={-1}>
        <SyncBanner />
        {children}
      </main>
      <footer className="footer">
        <div className="footer-inner">
          Dados fictícios do case técnico. Pasta monitorada: {status?.folder?.name ?? '—'} e subpastas · Fuso: America/São Paulo
        </div>
      </footer>
    </>
  );
}
