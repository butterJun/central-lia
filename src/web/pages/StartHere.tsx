import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import { formatDate, formatDateTime } from '../../shared/dates.ts';
import type { Onboarding } from '../../shared/domain.ts';
import { ActivityStatusBadge, DueDate } from '../components/Badges.tsx';
import { SourceLink } from '../components/SourceLink.tsx';
import { ErrorState, Loading, RequireMember } from '../components/States.tsx';
import { useMember } from '../member-context.tsx';
import { useOnboarding } from '../queries.ts';

/** Entry page for newcomers, built only from the direction documents in the Drive folder. */
export function StartHere() {
  return (
    <>
      <h1>Comece aqui</h1>
      <p className="lead">
        Quatro passos para entender a Liga e encontrar sua primeira ação. Tudo vem dos documentos da pasta do Drive; o que ainda não foi
        confirmado aparece marcado como tal.
      </p>
      <RequireMember>
        <OnboardingContent />
      </RequireMember>
    </>
  );
}

/** Drive text is untrusted: only plain formatting is rendered (no images, raw HTML or headings). */
const SAFE_MARKDOWN = ['p', 'ul', 'ol', 'li', 'strong', 'em', 'code', 'a', 'br'];

function PartialBadge() {
  return <span className="badge badge-warn">⚑ Provisório — a confirmar</span>;
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown skipHtml allowedElements={SAFE_MARKDOWN} unwrapDisallowed>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function OnboardingContent() {
  const { member } = useMember();
  const query = useOnboarding(member?.id ?? null);
  if (query.isLoading) return <Loading />;
  if (!query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data;
  return (
    <>
      <ol className="steps">
        <li>
          <h2>Entenda o propósito</h2>
          {data.purpose ? (
            <div className="card">
              {data.purpose.partial && <PartialBadge />}
              <Markdown text={data.purpose.markdown} />
              <p className="small">
                Fonte: <SourceLink source={data.purpose.source} />
              </p>
            </div>
          ) : (
            <p className="notice notice-warn">Nenhum documento de estado atual encontrado na pasta. Propósito a confirmar.</p>
          )}
        </li>
        <li>
          <h2>Conheça as frentes e quem faz o quê</h2>
          {data.fronts ? (
            <div className="card">
              <Markdown text={data.fronts.markdown} />
              <p className="small">
                Fonte: <SourceLink source={data.fronts.source} />
              </p>
            </div>
          ) : (
            <p className="notice notice-warn">As frentes ainda não estão descritas nos documentos de direção.</p>
          )}
        </li>
        <li>
          <h2>Saiba onde estão as atividades</h2>
          <RegistryExplanation data={data} />
        </li>
        <li>
          <h2>Sua primeira ação</h2>
          {data.firstAction ? (
            <div className="card card-accent">
              <p>
                <Link to={`/atividades/${data.firstAction.id}`}>
                  <strong>
                    {data.firstAction.id} — {data.firstAction.title}
                  </strong>
                </Link>
              </p>
              <p className="row">
                <DueDate dueDate={data.firstAction.dueDate} status={data.firstAction.status} />
                <ActivityStatusBadge status={data.firstAction.status} />
              </p>
              <Link to="/minhas">Ver todas as minhas atividades</Link>
            </div>
          ) : (
            <p className="notice notice-info">Você ainda não tem atividade atribuída. Procure a liderança da sua frente.</p>
          )}
        </li>
      </ol>
      {data.steps && (
        <section className="card" aria-labelledby="orientacao">
          <h2 id="orientacao">Orientação para quem chega</h2>
          <Markdown text={data.steps.markdown} />
          <p className="small">
            Fonte: <SourceLink source={data.steps.source} />
          </p>
        </section>
      )}
      <DocumentsAndGaps data={data} />
    </>
  );
}

function RegistryExplanation({ data }: { data: Onboarding }) {
  return (
    <div className="card">
      {data.registry ? (
        <p>
          As atividades foram importadas de <SourceLink source={data.registry.source} /> (aba {data.registry.sheet}), indicada como fonte em{' '}
          {data.registry.pointerFrom}, em {formatDateTime(data.registry.importedAt)}. Desde então, o registro oficial é esta aplicação.
        </p>
      ) : (
        <p className="notice notice-warn">A fonte das atividades ainda não foi identificada na pasta.</p>
      )}
      <p className="small">
        <strong>Regra de precedência:</strong> {data.precedenceRule}
      </p>
      <p className="small">
        Atas novas geram <Link to="/sugestoes">sugestões para revisar</Link>; nada muda no painel sem aprovação humana.
      </p>
    </div>
  );
}

function DocumentsAndGaps({ data }: { data: Onboarding }) {
  return (
    <div className="grid">
      <section className="card" aria-labelledby="docs">
        <h2 id="docs">Documentos de referência</h2>
        <ul className="stack" style={{ paddingLeft: '1.1rem' }}>
          {data.documents.map((doc) => (
            <li key={doc.source.fileId}>
              <SourceLink source={doc.source} /> {doc.partial && <PartialBadge />}
              {doc.description && <div className="small muted">{doc.description}</div>}
              {doc.updatedAt && <div className="small muted">Atualizado em {formatDate(doc.updatedAt)}</div>}
            </li>
          ))}
        </ul>
        {data.historical.length > 0 && (
          <>
            <h3>Histórico — não usar como regra atual</h3>
            <ul className="small" style={{ paddingLeft: '1.1rem' }}>
              {data.historical.map((item) => (
                <li key={item.source.fileId}>
                  <SourceLink source={item.source} />
                  {item.supersededBy && ` — substituído por ${item.supersededBy}`}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="card" aria-labelledby="lacunas">
        <h2 id="lacunas">O que ainda está em aberto</h2>
        {data.gaps.length === 0 ? (
          <p className="muted">Nenhuma lacuna registrada nos documentos.</p>
        ) : (
          <ul className="small" style={{ paddingLeft: '1.1rem' }}>
            {data.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
