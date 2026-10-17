import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { agent, type Run } from '../../api/agent';
import {
  canApplyRecommendations, filterRecommendations, isEligibleRecommendation, isStaleRecommendationPreview,
  recommendationsApi, type Recommendation, type RecommendationFilter, type RecommendationPreview,
} from '../../api/agent/recommendations';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Overlay';
import { useToast } from '../../components/Toast';
import { Badge, Callout, Empty, Loading, Money, Segmented } from '../../components/ui';
import { count, plural, readable } from '../../lib/format';
import { keys } from '../../state/queries';
import { refreshAfterRecommendations } from '../../state/recommendations';

const PAGE_SIZE = 20;
const STATUS_LABELS: Record<string, string> = {
  hipotese_explicita: 'Hipótese explícita', parametro: 'Parâmetro', pendencia: 'Pendente de validação',
  esclarecido: 'Esclarecida', limite_mvp: 'Limite do produto', pendencia_logistica: 'Pendência logística', arquitetura: 'Regra do sistema',
};

export function RecommendationEffects({ preview }: { preview: RecommendationPreview }) {
  const e = preview.effects;
  if (preview.snapshot_status === 'legacy_unavailable' || Object.values(e).some(value => value === null)) {
    return <Callout tone="info" icon="info">Efeito no lote indisponível: esta prévia não contém dados suficientes para informar lançamentos, débitos, créditos ou balanceamento. Consulte os resultados preservados na aba Revisão.</Callout>;
  }
  return <div className="stack">
    <div className="table-wrap"><table className="table">
      <caption className="sr-only">Efeito previsto das sugestões elegíveis no lote</caption>
      <thead><tr><th>Lote</th><th className="r">Antes</th><th className="r">Após aplicar</th></tr></thead>
      <tbody>
        <tr><td>Lançamentos</td><td className="r">{count(e.entries_before!)}</td><td className="r">{count(e.entries_after!)}</td></tr>
        <tr><td>Débitos</td><td className="r"><Money value={e.debit_before!} /></td><td className="r"><Money value={e.debit_after!} /></td></tr>
        <tr><td>Créditos</td><td className="r"><Money value={e.credit_before!} /></td><td className="r"><Money value={e.credit_after!} /></td></tr>
      </tbody>
    </table></div>
    <p className="help">{e.balanced ? 'O lote previsto permanece balanceado.' : 'O lote previsto exige revisão de balanceamento.'} A aprovação e a exportação continuam na aba Revisão.</p>
    <Callout tone="info" icon="info">Solicitações ao Comercial, identificação de valores e contestações a parceiros continuam pendentes até haver evidência de conclusão. Aplicar uma sugestão registra o tratamento do lote; não conclui essas tarefas nem envia mensagens.</Callout>
  </div>;
}

function RecommendationCard({ item, runId }: { item: Recommendation; runId: string }) {
  const eligible = isEligibleRecommendation(item);
  return <article className="card recommendation-card" id={`sugestao-${item.exception_id}`}>
    <div className="card-body stack">
      <div className="row between wrap">
        <h3 className="card-title">{item.title || readable(item.kind)}</h3>
        <Badge tone={item.status === 'decided' ? 'neutral' : eligible ? 'good' : 'warning'} dot>{item.status === 'decided' ? 'Decidida' : eligible ? 'Elegível' : 'Aguarda revisão'}</Badge>
      </div>
      <p className="mono muted" style={{ fontSize: 11 }}>{item.exception_id}</p>
      <dl className="recommendation-explanation">
        <div><dt>Fato observado</dt><dd>{item.fact}</dd></div>
        <div><dt>Regra aplicada</dt><dd>{item.rule}</dd></div>
        <div><dt>Recomendação e motivo</dt><dd>{item.reason}</dd></div>
        <div><dt>Efeito no lote</dt><dd>{item.effect}</dd></div>
        <div><dt>Próximo passo</dt><dd>{item.follow_up || 'Revisar o resultado e a aprovação do lote.'}</dd></div>
      </dl>
      <div className="row wrap">
        <span className="chip">Responsável: {item.owner || 'A definir'}</span>
        <span className="chip">Valor relacionado: {item.exposure_brl === null ? 'não calculado' : <Money value={item.exposure_brl} />}</span>
        {item.severity === 'bloqueante' && <Badge tone="critical">Bloqueante</Badge>}
      </div>
      <p className="help">O valor relacionado identifica a exposição da ocorrência; o efeito financeiro da ação está descrito acima.</p>
      {item.status === 'open' && !eligible && <Callout tone="warning" icon="alert">
        {item.ineligible_reason || 'Esta sugestão depende de revisão individual.'}
        {!!item.missing_evidence.length && <ul>{item.missing_evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}</ul>}
      </Callout>}
      <div className="row wrap">
        <Link className="btn sm" to={`/runs/${runId}/revisao?ex=${encodeURIComponent(item.exception_id)}`}><Icon name="alert" />Abrir ocorrência</Link>
        {item.assumption_ids.map(id => <Link key={id} className="chip" to={`/runs/${runId}/hipoteses?ex=${encodeURIComponent(item.exception_id)}#hipotese-${encodeURIComponent(id)}`}><Icon name="origin" size={12} />Hipótese {id}</Link>)}
      </div>
      <details className="recommendation-evidence">
        <summary>Consultar {plural(item.evidence.length, 'evidência', 'evidências')} desta execução</summary>
        {item.evidence.length ? <div className="table-wrap"><table className="table">
          <thead><tr><th>Arquivo</th><th>Referência</th><th>Linha</th></tr></thead>
          <tbody>{item.evidence.map((row, index) => <tr key={index}>
            <td className="mono wrap">{row.arquivo || row.arquivo_origem || row.source_file || 'Fonte registrada'}</td>
            <td className="mono wrap">{row.ref || row.ref_origem || row.source_ref || '—'}</td>
            <td>{row.linha || row.source_row || row.physical_row || '—'}</td>
          </tr>)}</tbody>
        </table></div> : <p className="help">Nenhuma linha de origem está disponível para esta sugestão.</p>}
      </details>
    </div>
  </article>;
}

export default function RecommendationsTab({ run }: { run: Run }) {
  const [params, setParams] = useSearchParams();
  const { hash } = useLocation();
  const exceptionId = params.get('ex');
  const [filter, setFilter] = useState<RecommendationFilter>('all');
  const [page, setPage] = useState(1);
  const [confirmation, setConfirmation] = useState<RecommendationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const client = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: keys.recommendations(run.id), queryFn: () => recommendationsApi.preview(run.id),
    enabled: agent.mode === 'http', staleTime: 0,
  });
  const preview = query.data;
  const selectedAssumption = hash.startsWith('#hipotese-') ? decodeURIComponent(hash.slice('#hipotese-'.length)) : '';
  useEffect(() => { setPage(1); }, [filter, exceptionId]);
  useEffect(() => {
    if (selectedAssumption && preview) document.getElementById(`hipotese-${selectedAssumption}`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedAssumption, preview]);
  useEffect(() => {
    if (confirmation && preview && confirmation.preview_token !== preview.preview_token) {
      setConfirmation(null);
      setNotice('A execução mudou desde a prévia. Confira os resultados atualizados e abra uma nova confirmação.');
    }
  }, [confirmation, preview]);

  if (agent.mode !== 'http') return <div className="card"><Empty icon="info" title="Sugestões indisponíveis na demonstração">As hipóteses e sugestões precisam das evidências preservadas de uma execução no servidor.</Empty></div>;
  if (query.isLoading) return <Loading label="Consultando hipóteses e sugestões desta execução…" />;
  if (query.error || !preview) return <Callout tone="warning" icon="alert">{query.error?.message || 'A prévia ainda não está disponível.'} <button className="link" onClick={() => void query.refetch()}>Tentar novamente</button></Callout>;

  const ready = canApplyRecommendations(preview) && run.status === 'awaiting_approval' && !run.draft;
  const filtered = filterRecommendations(preview.recommendations, filter, exceptionId);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const apply = async () => {
    if (!confirmation || !confirmation.preview_token || !canApplyRecommendations(confirmation) || busy) return;
    setBusy(true);
    try {
      const result = await recommendationsApi.apply(run.id, confirmation.preview_token);
      setConfirmation(null);
      setNotice(result.already_applied ? 'As sugestões desta prévia já haviam sido aplicadas. Nenhuma decisão foi duplicada.' : `${plural(result.applied, 'sugestão aplicada', 'sugestões aplicadas')}. Confira as pendências restantes e a aba Revisão para aprovar o lote.`);
      await refreshAfterRecommendations(client, run.id);
    } catch (error) {
      setConfirmation(null);
      if (isStaleRecommendationPreview(error)) {
        setNotice('A prévia não corresponde mais ao estado atual da execução. Confira os dados recarregados e confirme novamente.');
        await query.refetch();
      } else {
        setNotice('Não foi possível confirmar a aplicação. Atualize a prévia para consultar o estado registrado antes de tentar novamente.');
        toast.error(error);
        await query.refetch();
      }
    } finally { setBusy(false); }
  };

  return <div className="stack-lg">
    <section className="card">
      <div className="card-head row between wrap">
        <div><h2 className="card-title">Hipóteses e sugestões</h2><p className="card-sub">Base da decisão nesta execução · política {preview.policy_version || 'não capturada'}</p></div>
        <div className="row wrap">
          <button className="btn sm" disabled={query.isFetching || busy} onClick={() => void query.refetch()}><Icon name="refresh" />Atualizar prévia</button>
          <button className="btn primary" disabled={!ready || query.isFetching || busy} onClick={() => { setNotice(''); setConfirmation(preview); }}><Icon name="check" />Seguir sugestões do agente</button>
        </div>
      </div>
      <div className="card-body stack-lg">
        {notice && <Callout tone="info" icon="info">{notice}</Callout>}
        {preview.snapshot_status === 'legacy_unavailable' && <Callout tone="warning" icon="lock">Não há uma versão das hipóteses preservada para esta execução. As sugestões não podem ser aplicadas em conjunto. Consulte a revisão individual; em execuções concluídas sem esse registro, crie uma nova execução para capturar as hipóteses.</Callout>}
        {run.draft && <Callout tone="gate" icon="lock">Execução de teste: a prévia é consultável, mas as sugestões não podem ser aplicadas.</Callout>}
        {run.status !== 'awaiting_approval' && !run.draft && <p className="help">As sugestões podem ser aplicadas enquanto a execução aguarda aprovação.</p>}
        {preview.snapshot_status === 'captured' && <div className="recommendation-summary">
          <div className="kpi"><span className="kpi-label">Elegíveis para aplicar</span><strong className="kpi-value num">{count(preview.summary.eligible)}</strong></div>
          <div className="kpi"><span className="kpi-label">Aguardam revisão</span><strong className="kpi-value num">{count(preview.summary.waiting)}</strong></div>
          <div className="kpi"><span className="kpi-label">Já decididas</span><strong className="kpi-value num">{count(preview.summary.decided)}</strong></div>
        </div>}
        <RecommendationEffects preview={preview} />
      </div>
    </section>

    <div className="recommendations-layout">
      <section className="stack-lg" aria-label="Sugestões por ocorrência">
        <div className="row between wrap">
          <Segmented<RecommendationFilter> label="Sugestões" value={filter} onChange={setFilter} options={[
            { value: 'all', label: 'Todas' }, { value: 'eligible', label: 'Elegíveis' }, { value: 'waiting', label: 'Pendentes' }, { value: 'decided', label: 'Decididas' },
          ]} />
          <span className="muted">{plural(filtered.length, 'sugestão', 'sugestões')}</span>
        </div>
        {exceptionId && <div className="row wrap"><span className="chip mono">Ocorrência {exceptionId}</span><button className="link" onClick={() => setParams({})}>Ver todas as ocorrências</button></div>}
        {shown.length ? shown.map(item => <RecommendationCard key={item.id} item={item} runId={run.id} />) : <div className="card"><Empty icon="info" title="Nenhuma sugestão com estes filtros" /></div>}
        {pages > 1 && <nav className="row between wrap" aria-label="Páginas de sugestões">
          <button className="btn sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button>
          <span className="muted">Página {currentPage} de {pages} · até {PAGE_SIZE} sugestões por página</span>
          <button className="btn sm" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Próxima</button>
        </nav>}
      </section>
      <aside className="card recommendation-assumptions" aria-label="Hipóteses da execução">
        <div className="card-head"><h3 className="card-title">Hipóteses da execução</h3><p className="card-sub">Fonte, interpretação e consequência de cada hipótese preservada.</p></div>
        <div className="card-body stack">
          {preview.assumptions.length ? preview.assumptions.map(item => <details key={item.id} id={`hipotese-${item.id}`} className="assumption" open={selectedAssumption === item.id ? true : undefined}>
            <summary><span className="mono muted">{item.id}</span> {item.question}</summary>
            {item.status && <Badge tone={item.status.includes('pendencia') ? 'warning' : 'neutral'}>{STATUS_LABELS[item.status] || readable(item.status)}</Badge>}
            <p><strong>Fonte:</strong> {item.source || 'Fonte não informada'}</p>
            <p><strong>Interpretação adotada:</strong> {item.decision || 'Não informada'}</p>
            <p><strong>Se mudar:</strong> {item.impact || 'Impacto ainda não descrito'}</p>
            <p className="help">{plural(preview.recommendations.filter(recommendation => recommendation.assumption_ids.includes(item.id)).length, 'sugestão vinculada', 'sugestões vinculadas')} nesta execução.</p>
          </details>) : <p className="help">Não há hipóteses preservadas disponíveis nesta execução.</p>}
        </div>
      </aside>
    </div>

    {confirmation && <Modal wide eyebrow="Prévia da aplicação" title={`Aplicar ${plural(confirmation.summary.eligible, 'sugestão elegível', 'sugestões elegíveis')}?`}
      sub="As justificativas serão registradas por ocorrência, com a regra e as evidências desta execução."
      onClose={() => { if (!busy) setConfirmation(null); }}
      footer={<><button className="btn ghost" disabled={busy} onClick={() => setConfirmation(null)}>Voltar à revisão</button><button className="btn primary" disabled={busy || !ready || !canApplyRecommendations(confirmation) || confirmation.preview_token !== preview.preview_token} onClick={() => void apply()}>{busy ? <span className="spin" /> : <Icon name="check" />}Aplicar {confirmation.summary.eligible} sugestões elegíveis</button></>}>
      <div className="stack-lg">
        <p><strong>Todas as {count(confirmation.summary.eligible)} sugestões elegíveis desta execução serão aplicadas</strong>, incluindo ocorrências fora dos filtros e da página atual. {count(confirmation.summary.waiting)} aguardam revisão e {count(confirmation.summary.decided)} já foram decididas.</p>
        <div className="table-wrap"><table className="table"><caption className="sr-only">Todas as sugestões que serão aplicadas</caption><thead><tr><th>Tipo</th><th>Ação</th><th className="r">Quantidade</th></tr></thead><tbody>{Object.entries(confirmation.recommendations.filter(isEligibleRecommendation).reduce<Record<string, number>>((groups, item) => { groups[item.kind] = (groups[item.kind] || 0) + 1; return groups; }, {})).map(([kind, total]) => <tr key={kind}><td>{readable(kind)}</td><td>Manter tratamento atual e registrar justificativa</td><td className="r">{count(total)}</td></tr>)}</tbody></table></div>
        <RecommendationEffects preview={confirmation} /><Link className="link" to={`/runs/${run.id}/revisao`}>A aprovação final permanece na aba Revisão</Link>
      </div>
    </Modal>}
  </div>;
}
