// Drill-down opened from the Summary cards: commissions by merchant with the origin of each value.
import { useMemo, useState } from 'react';
import type { AppState, Comissao } from '../../api/types';
import { downloads } from '../../api/core';
import { HBarChart } from '../../components/charts/Bars';
import { DataTable } from '../../components/DataTable';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Overlay';
import { TraceView } from '../../components/TraceView';
import { Badge, Callout, Money, OriginButton, Segmented } from '../../components/ui';
import { cnpj, count, moneyShort, money } from '../../lib/format';

type Line = 'ALL' | 'CHECKOUT' | 'REMESSA';

export function CommissionsPanel({ state, line: initial, onClose }: { state: AppState; line?: string; onClose: () => void }) {
  const [line, setLine] = useState<Line>(initial === 'CHECKOUT' || initial === 'REMESSA' ? initial : 'ALL');
  const [trace, setTrace] = useState<Comissao | null>(null);
  const s = state.summary;
  const rows = useMemo(() => state.results.comissoes.filter(row => line === 'ALL' || row.linha_negocio === line), [state, line]);
  const top = useMemo(() => [...rows].filter(row => Number(row.comissao_brl) > 0)
    .sort((a, b) => Number(b.comissao_brl) - Number(a.comissao_brl)).slice(0, 10), [rows]);

  return (
    <Sheet
      eyebrow="Resumo · comissões"
      title={trace ? trace.lojista : 'Comissões por lojista'}
      sub={trace ? `${trace.linha_negocio === 'REMESSA' ? 'Remessa' : 'Checkout'} · ${money(trace.comissao_brl)} · origem de cada contribuição` : 'Checkout pela taxa contratada vigente; remessa pela participação no spread realizado.'}
      onClose={onClose}
      headerExtra={trace
        ? <button className="btn sm" onClick={() => setTrace(null)}><Icon name="arrowLeft" />Voltar à lista</button>
        : <a className="btn sm" href={downloads.csv('comissoes_por_lojista.csv', { comp: state.period, run_id: state.run_id })} download><Icon name="download" />CSV</a>}
    >
      {trace ? <TraceView id={trace.id_saida} /> : (
        <div className="stack-lg">
          <div className="grid grid-3">
            <div className="kpi"><span className="kpi-label">Checkout</span><span className="kpi-value"><Money value={s.checkout_brl} /></span><span className="kpi-detail">{count(s.checkout_count)} transações na origem</span></div>
            <div className="kpi"><span className="kpi-label">Remessa</span><span className="kpi-value"><Money value={s.remessa_brl} /></span><span className="kpi-detail">{count(s.remessa_count)} operações únicas</span></div>
            <div className="kpi"><span className="kpi-label">Lojistas com comissão</span><span className="kpi-value">{count(new Set(state.results.comissoes.map(row => row.cnpj)).size)}</span><span className="kpi-detail">{count(state.results.comissoes.length)} linhas lojista × negócio</span></div>
          </div>
          <Callout tone="info">Operações sem cadastro e contrato confirmados não entram na comissão. A pendência de cadastro reúne as operações da empresa na competência; aceitar como ressalva mantém o faturamento bloqueado.</Callout>
          <div className="card">
            <div className="card-head">
              <div><h3 className="card-title">Maiores comissões</h3><p className="card-sub">Top 10 {line === 'ALL' ? 'de checkout e remessa' : line === 'CHECKOUT' ? 'de checkout' : 'de remessa'} · clique para ver a origem</p></div>
              <Segmented<Line> value={line} onChange={setLine} label="Linha de negócio" options={[{ value: 'ALL', label: 'Todas' }, { value: 'CHECKOUT', label: 'Checkout' }, { value: 'REMESSA', label: 'Remessa' }]} />
            </div>
            <div className="card-body">
              <HBarChart ariaLabel="Maiores comissões por lojista" labelWidth={220}
                data={top.map(row => ({ key: row.id_saida, label: row.lojista, value: Number(row.comissao_brl), display: moneyShort(row.comissao_brl), sub: row.linha_negocio === 'REMESSA' ? 'remessa' : undefined }))}
                onSelect={key => setTrace(rows.find(row => row.id_saida === key) || null)} />
            </div>
          </div>
          <div className="card">
            <DataTable<Comissao>
              rows={rows}
              rowKey={row => row.id_saida}
              search={row => `${row.lojista} ${row.cnpj}`}
              onRowClick={setTrace}
              initialSort={{ key: 'comissao', dir: 'desc' }}
              columns={[
                { key: 'lojista', label: 'Lojista', render: row => <span className="strong">{row.lojista}</span>, value: row => row.lojista },
                { key: 'cnpj', label: 'CNPJ', render: row => <span className="mono">{cnpj(row.cnpj)}</span> },
                { key: 'linha', label: 'Linha', render: row => <Badge tone={row.linha_negocio === 'REMESSA' ? 'gate' : 'info'}>{row.linha_negocio === 'REMESSA' ? 'Remessa' : 'Checkout'}</Badge> },
                { key: 'origens', label: 'Origens', align: 'right', render: row => count(row.quantidade_origens), value: row => row.quantidade_origens || 0 },
                { key: 'comissao', label: 'Comissão', align: 'right', render: row => <Money value={row.comissao_brl} />, value: row => Number(row.comissao_brl) },
                { key: 'origem', label: '', align: 'right', render: row => <OriginButton onClick={() => setTrace(row)} /> },
              ]}
            />
          </div>
        </div>
      )}
    </Sheet>
  );
}
