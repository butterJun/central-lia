import { useSearchParams } from 'react-router-dom';
import { SuggestionCard } from '../components/SuggestionCard.tsx';
import { EmptyState, ErrorState, Loading } from '../components/States.tsx';
import { useMember } from '../member-context.tsx';
import { useSuggestions } from '../queries.ts';

const TABS = [
  { value: 'pending', label: 'Pendentes' },
  { value: 'accepted,adjusted,rejected', label: 'Revisadas' },
  { value: 'superseded', label: 'Substituídas' },
] as const;

export function SuggestionsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'pending';
  const query = useSuggestions(status);
  const { member } = useMember();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Sugestões para revisar</h1>
          <p className="lead">
            Propostas extraídas de documentos novos ou alterados no Drive. Nenhuma vira oficial sem aceite humano; cada uma mostra o trecho
            exato e o link da fonte.
          </p>
        </div>
      </div>
      {member?.role === 'reviewer' ? (
        <p className="notice notice-info">Você tem perfil de revisão: pode aceitar, ajustar ou rejeitar.</p>
      ) : (
        <p className="notice notice-info">Para revisar, troque o perfil para Bruno ou Carla no topo da página.</p>
      )}
      <div className="row" role="group" aria-label="Filtrar sugestões">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={status === tab.value ? '' : 'secondary'}
            aria-pressed={status === tab.value}
            onClick={() => setParams({ status: tab.value }, { replace: true })}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div style={{ marginTop: '1rem' }}>
        {query.isLoading && <Loading label="Carregando sugestões…" />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {query.data && query.data.length === 0 && (
          <EmptyState title={status === 'pending' ? 'Nada pendente de revisão' : 'Nenhuma sugestão nesta lista'}>
            Quando uma ata nova ou alterada entrar na pasta do Drive, as propostas aparecem aqui.
          </EmptyState>
        )}
        {query.data?.map((suggestion) => <SuggestionCard key={suggestion.id} suggestion={suggestion} />)}
      </div>
    </>
  );
}
