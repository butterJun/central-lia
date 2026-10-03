import { lazy, Suspense, useEffect, useRef } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout.tsx';
import { Loading } from './components/States.tsx';

/** Pages load on demand to keep the first download small. */
const Overview = lazy(() => import('./pages/Overview.tsx').then((m) => ({ default: m.Overview })));
const StartHere = lazy(() => import('./pages/StartHere.tsx').then((m) => ({ default: m.StartHere })));
const ActivitiesPage = lazy(() => import('./pages/ActivitiesPage.tsx').then((m) => ({ default: m.ActivitiesPage })));
const ActivityDetailPage = lazy(() => import('./pages/ActivityDetailPage.tsx').then((m) => ({ default: m.ActivityDetailPage })));
const NewActivityPage = lazy(() => import('./pages/NewActivityPage.tsx').then((m) => ({ default: m.NewActivityPage })));
const SuggestionsPage = lazy(() => import('./pages/SuggestionsPage.tsx').then((m) => ({ default: m.SuggestionsPage })));
const NewsPage = lazy(() => import('./pages/NewsPage.tsx').then((m) => ({ default: m.NewsPage })));
const SyncPage = lazy(() => import('./pages/SyncPage.tsx').then((m) => ({ default: m.SyncPage })));

const TITLES: Array<[RegExp, string]> = [
  [/^\/comece-aqui/, 'Comece aqui'],
  [/^\/minhas/, 'Minhas atividades'],
  [/^\/atividades\/nova/, 'Nova atividade'],
  [/^\/atividades\/.+/, 'Atividade'],
  [/^\/atividades/, 'Todas as atividades'],
  [/^\/sugestoes/, 'Sugestões para revisar'],
  [/^\/novidades/, 'Novidades dos documentos'],
  [/^\/sincronizacao/, 'Estado da sincronização'],
];

/** Updates the document title and moves focus to the content after client-side navigation. */
function useRouteAnnouncements() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    const title = TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'Visão geral';
    document.title = `${title} · Central da Liga IA`;
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById('conteudo')?.focus();
  }, [pathname]);
}

function NotFound() {
  return (
    <>
      <h1>Página não encontrada</h1>
      <p>
        <Link to="/">Voltar à visão geral</Link>
      </p>
    </>
  );
}

export function App() {
  useRouteAnnouncements();
  return (
    <Layout>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/comece-aqui" element={<StartHere />} />
          <Route path="/minhas" element={<ActivitiesPage mode="mine" />} />
          <Route path="/atividades" element={<ActivitiesPage mode="all" />} />
          <Route path="/atividades/nova" element={<NewActivityPage />} />
          <Route path="/atividades/:id" element={<ActivityDetailPage />} />
          <Route path="/sugestoes" element={<SuggestionsPage />} />
          <Route path="/novidades" element={<NewsPage />} />
          <Route path="/sincronizacao" element={<SyncPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
