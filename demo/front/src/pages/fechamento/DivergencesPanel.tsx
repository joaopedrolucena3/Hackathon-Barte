// Drill-down opened from the Summary: contracted × applied rate, with the impact in R$ and a path to review.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Insights, RunRef } from '../../api/agent';
import type { AppState, Divergencia } from '../../api/types';
import { downloads } from '../../api/core';
import { HBarChart } from '../../components/charts/Bars';
import { DataTable } from '../../components/DataTable';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Overlay';
import { TraceView } from '../../components/TraceView';
import { Badge, Callout, Money, OriginButton, Percent, PP, Segmented } from '../../components/ui';
import { diffPercent } from '../../lib/decimal';
import { count, moneyShort, plural, productNames } from '../../lib/format';

type Line = 'ALL' | 'CHECKOUT' | 'REMESSA';

export function DivergencesPanel({ state, insights, run, onClose }: { state: AppState; insights?: Insights; run?: RunRef; onClose: () => void }) {
  const navigate = useNavigate();
  const [line, setLine] = useState<Line>('ALL');
  const [merchant, setMerchant] = useState<string | null>(null);
  const [trace, setTrace] = useState<Divergencia | null>(null);
  const s = state.summary;
  const pendencyByDivergence = useMemo(() => new Map(state.results.pendencias.filter(p => p.divergence_id).map(p => [p.divergence_id!, p])), [state]);
  const rows = useMemo(() => state.results.divergencias.filter(row => (line === 'ALL' || row.linha_negocio === line) && (!merchant || row.cnpj === merchant)), [state, line, merchant]);
  const review = (row: Divergencia) => {
    const pendency = pendencyByDivergence.get(row.id_saida);
    if (run && pendency) { onClose(); navigate(`/runs/${run.id}/revisao?ex=${pendency.id_saida}`); }
  };

  return (
    <Sheet
      eyebrow="Resumo · divergências de taxa"
      title={trace ? `Transação ${trace.ref_origem}` : 'Divergências de taxa'}
      sub={trace ? `${trace.lojista} · aplicada ${trace.taxa_aplicada_pct}% × contratada ${trace.taxa_contratada_pct}%` : 'Taxa aplicada pela Orbe e pela Ponte comparada com a contratada vigente na data original.'}
      onClose={onClose}
      headerExtra={trace
        ? <button className="btn sm" onClick={() => setTrace(null)}><Icon name="arrowLeft" />Voltar à lista</button>
        : <a className="btn sm" href={downloads.csv('divergencias_taxa.csv', { comp: state.period, run_id: state.run_id })} download><Icon name="download" />CSV</a>}
    >
      {trace ? <TraceView id={trace.id_saida} /> : (
        <div className="stack-lg">
          <div className="grid grid-3">
            <div className="kpi attention"><span className="kpi-label">Exposição (soma dos valores absolutos)</span><span className="kpi-value"><Money value={s.divergencias_abs_brl} /></span><span className="kpi-detail">{count(s.divergencias_count)} diferenças para revisão</span></div>
            <div className="kpi"><span className="kpi-label">Valor assinado</span><span className="kpi-value"><Money value={s.divergencias_brl} /></span><span className="kpi-detail">Cobrado a mais menos cobrado a menos</span></div>
            <div className="kpi"><span className="kpi-label">Lojistas afetados</span><span className="kpi-value">{count(insights?.divergencias_por_lojista.length)}</span><span className="kpi-detail">Checkout e remessa</span></div>
          </div>
          <Callout tone="info">Divergência não reduz comissão sozinha: vira exceção na revisão. Alteração de taxa acontece em Cadastros, com vigência e justificativa.</Callout>
          <div className="card">
            <div className="card-head">
              <div><h3 className="card-title">Impacto por lojista</h3><p className="card-sub">Soma dos valores absolutos · clique numa barra para filtrar a tabela</p></div>
              {merchant && <button className="btn sm" onClick={() => setMerchant(null)}><Icon name="x" />Limpar filtro</button>}
            </div>
            <div className="card-body">
              <HBarChart ariaLabel="Impacto das divergências por lojista" labelWidth={220} color="var(--series-2)"
                data={(insights?.divergencias_por_lojista || []).slice(0, 10).map(item => ({
                  key: item.cnpj, label: item.lojista, value: Number(item.abs_brl), display: moneyShort(item.abs_brl), sub: plural(item.count, 'transação', 'transações'),
                }))}
                onSelect={setMerchant} />
            </div>
          </div>
          <div className="card">
            <DataTable<Divergencia>
              rows={rows}
              rowKey={row => row.id_saida}
              search={row => `${row.lojista} ${row.cnpj} ${row.ref_origem}`}
              onRowClick={setTrace}
              initialSort={{ key: 'impacto', dir: 'desc' }}
              toolbar={<Segmented<Line> value={line} onChange={setLine} label="Linha de negócio" options={[{ value: 'ALL', label: 'Todas' }, { value: 'CHECKOUT', label: 'Checkout' }, { value: 'REMESSA', label: 'Remessa' }]} />}
              columns={[
                { key: 'lojista', label: 'Lojista', render: row => <span className="strong">{row.lojista}</span>, value: row => row.lojista },
                { key: 'ref', label: 'Transação', render: row => <span className="mono">{row.ref_origem}</span> },
                { key: 'produto', label: 'Produto', render: row => row.linha_negocio === 'REMESSA' ? <Badge tone="gate">Remessa</Badge> : productNames[row.produto || ''] || row.produto || '—' },
                { key: 'contratada', label: 'Contratada', align: 'right', render: row => <Percent value={row.taxa_contratada_pct} /> },
                { key: 'aplicada', label: 'Aplicada', align: 'right', render: row => <Percent value={row.taxa_aplicada_pct} /> },
                { key: 'pp', label: 'Diferença', align: 'right', render: row => <PP value={diffPercent(row.taxa_aplicada_pct, row.taxa_contratada_pct)} />, value: row => Number(diffPercent(row.taxa_aplicada_pct, row.taxa_contratada_pct)) },
                { key: 'impacto', label: 'Impacto', align: 'right', render: row => <Money value={row.diferenca_brl} />, value: row => Math.abs(Number(row.diferenca_brl)) },
                {
                  key: 'acoes', label: '', align: 'right', render: row => (
                    <span className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                      <OriginButton onClick={() => setTrace(row)} />
                      {run && pendencyByDivergence.has(row.id_saida) && <button className="btn xs" onClick={event => { event.stopPropagation(); review(row); }}>Revisar</button>}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </div>
      )}
    </Sheet>
  );
}
