import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Empty, Loading } from './components/ui';
import { lastComp, useCompetencias, useDataScope, useRuns } from './state/queries';

const Fechamento = lazy(() => import('./pages/Fechamento'));
const RunPage = lazy(() => import('./pages/RunPage'));
const NotasBancos = lazy(() => import('./pages/NotasBancos'));
const Cadastros = lazy(() => import('./pages/Cadastros'));
const PipelinePage = lazy(() => import('./pages/Pipeline'));
const Comunicacoes = lazy(() => import('./pages/Comunicacoes'));

function Home() {
  const { data: months, error, refetch } = useCompetencias();
  if (error) return <Empty icon="alert" title="Não foi possível carregar as competências">{error.message}<button className="btn" onClick={() => refetch()}>Tentar novamente</button></Empty>;
  if (!months) return <Loading page label="Preparando o fechamento…" />;
  const fallback = months.find(month => month.current)?.comp || months.find(month => month.has_data)?.comp || months[0]?.comp;
  if (!fallback) return <Empty icon="info" title="Nenhuma competência reconhecida">Cadastre as fontes para iniciar o fechamento.</Empty>;
  const remembered = lastComp(fallback);
  return <Navigate to={`/competencias/${months.some(month => month.comp === remembered) ? remembered : fallback}`} replace />;
}

/** "Execução" in the nav opens the latest run of the competência in focus. */
function LatestRun() {
  const scope = useDataScope();
  const { data: runs, isLoading, error } = useRuns(scope.comp);
  if (scope.run_id) return <Navigate to={`/runs/${scope.run_id}`} replace />;
  if (isLoading) return <Loading page />;
  if (error) return <Empty icon="alert" title="Não foi possível carregar as execuções">{error.message}</Empty>;
  const latest = runs?.find(run => !run.draft) || runs?.[0];
  if (latest) return <Navigate to={`/runs/${latest.id}`} replace />;
  return <Navigate to={scope.comp ? `/competencias/${scope.comp}?sem-run=1` : '/'} replace />;
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);
  return null;
}

export function App() {
  // The selected run loads its own snapshot/progress. A not-yet-produced global result
  // must never hide the run route or prevent its event stream from subscribing.
  return (
    <Shell>
      <ScrollTop />
      <Suspense fallback={<Loading page />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/competencias/:comp" element={<Fechamento />} />
          <Route path="/runs" element={<LatestRun />} />
          <Route path="/runs/:runId" element={<RunPage tab="passos" />} />
          <Route path="/runs/:runId/revisao" element={<RunPage tab="revisao" />} />
          <Route path="/runs/:runId/hipoteses" element={<RunPage tab="hipoteses" />} />
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
