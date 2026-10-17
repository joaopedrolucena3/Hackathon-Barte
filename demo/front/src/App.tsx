import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Empty, Loading } from './components/ui';
import { lastComp, useAppState, useRuns } from './state/queries';

const Fechamento = lazy(() => import('./pages/Fechamento'));
const RunPage = lazy(() => import('./pages/RunPage'));
const NotasBancos = lazy(() => import('./pages/NotasBancos'));
const Cadastros = lazy(() => import('./pages/Cadastros'));
const PipelinePage = lazy(() => import('./pages/Pipeline'));
const Comunicacoes = lazy(() => import('./pages/Comunicacoes'));

function Home() {
  const { data } = useAppState();
  return data ? <Navigate to={`/competencias/${lastComp(data.period)}`} replace /> : <Loading page label="Preparando o fechamento…" />;
}

/** "Execuções" and "Revisão" in the nav open the latest run of the competência in focus. */
function LatestRun({ section = '' }: { section?: string }) {
  const { data: state } = useAppState();
  const comp = state ? lastComp(state.period) : '';
  const { data: runs, isLoading } = useRuns(comp);
  if (!state || isLoading) return <Loading page />;
  const latest = runs?.find(run => !run.draft) || runs?.[0];
  if (latest) return <Navigate to={`/runs/${latest.id}${section}`} replace />;
  return <Navigate to={`/competencias/${comp}?sem-run=1`} replace />;
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);
  return null;
}

export function App() {
  const { error, refetch } = useAppState();
  if (error) {
    return (
      <div className="loading page">
        <Empty icon="alert" title="Não foi possível carregar o fechamento">{error.message}</Empty>
        <button className="btn primary" onClick={() => refetch()}>Tentar novamente</button>
      </div>
    );
  }
  return (
    <Shell>
      <ScrollTop />
      <Suspense fallback={<Loading page />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/competencias/:comp" element={<Fechamento />} />
          <Route path="/runs" element={<LatestRun />} />
          <Route path="/revisao" element={<LatestRun section="/revisao" />} />
          <Route path="/runs/:runId" element={<RunPage tab="passos" />} />
          <Route path="/runs/:runId/revisao" element={<RunPage tab="revisao" />} />
          <Route path="/runs/:runId/auditoria" element={<RunPage tab="auditoria" />} />
          <Route path="/notas-bancos" element={<NotasBancos />} />
          <Route path="/cadastros" element={<Cadastros />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/comunicacoes" element={<Comunicacoes />} />
          <Route path="*" element={<Empty icon="search" title="Página não encontrada">Use o menu para voltar ao fechamento.</Empty>} />
        </Routes>
      </Suspense>
    </Shell>
  );
}
