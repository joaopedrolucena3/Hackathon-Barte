// B6 + C8: the rows, rule, formula and contract behind one result, read from GET /api/trace.
import type { Detail } from '../api/types';
import { cnpj, count, dateBR, money, percent, productNames } from '../lib/format';
import { useTrace } from '../state/queries';
import { Icon } from './Icon';
import { Callout, Empty, Loading, Money } from './ui';

const ROUNDING = (text = '') => text.replaceAll('ROUND_HALF_UP', 'arredondamento comercial').replaceAll('HALF_UP', 'arredondamento comercial');

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  const shown = items.filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== '—');
  if (!shown.length) return null;
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px 16px', margin: '10px 0 0' }}>
      {shown.map(([label, value]) => (
        <div key={label}>
          <dt className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.3px', fontWeight: 600 }}>{label}</dt>
          <dd style={{ margin: '2px 0 0', fontSize: 13 }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DetailCard({ detail }: { detail: Detail }) {
  const e = detail.entrada || ({} as NonNullable<Detail['entrada']>);
  const c = detail.contract;
  return (
    <div className="card" style={{ padding: 14, boxShadow: 'none' }}>
      <div className="row between wrap">
        <strong style={{ fontSize: 13 }}>{detail.regra || 'Regra aplicada'}</strong>
        <span className="mono muted">{detail.arquivo_origem}{detail.source_row ? ` · linha ${detail.source_row}` : ''}</span>
      </div>
      {detail.formula && <p className="mono" style={{ marginTop: 8, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12 }}>{ROUNDING(detail.formula)}</p>}
      {detail.motivo && <p className="text-2" style={{ marginTop: 8, fontSize: 13 }}>{detail.motivo}</p>}
      <Facts items={[
        ['Resultado', detail.valor !== undefined ? <Money value={detail.valor} /> : undefined],
        ['Referência', <span className="mono">{detail.ref_origem}</span>],
        ['Data', e.date ? dateBR(e.date) : e.contracted_date ? dateBR(e.contracted_date) : undefined],
        ['Lojista / cliente', e.name],
        ['Bruto', e.gross ? money(e.gross) : e.gross_brl ? money(e.gross_brl) : undefined],
        ['Taxa aplicada', e.applied_rate_pct ? percent(e.applied_rate_pct) : undefined],
        ['Venda original', e.original_id ? `${e.original_id} · ${dateBR(e.original_date)}` : undefined],
        ['Moeda estrangeira', e.foreign_amount ? `${e.currency} ${e.foreign_amount}` : undefined],
        ['PTAX', e.ptax_rate],
        ['Spread realizado', e.spread_brl ? money(e.spread_brl) : undefined],
        ['Valor no extrato', e.amount ? money(e.amount) : undefined],
        ['Histórico', e.description],
      ]} />
      {c && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <p className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.3px', fontWeight: 600 }}>Contrato vigente aplicado</p>
          <Facts items={[
            ['Taxa contratada', percent(c.rate_pct)],
            ['Produto', productNames[c.product] || c.product],
            ['Vigência', `${c.start ? dateBR(c.start) : 'sem início'} → ${c.end ? dateBR(c.end) : 'em aberto'}`],
            ['CNPJ', cnpj(c.cnpj)],
            ['Fonte', c.source_ref ? `${c.source_file} · ${c.source_ref}` : c.source_file],
          ]} />
          {c.rule && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{c.rule}</p>}
        </div>
      )}
    </div>
  );
}

export function TraceView({ id }: { id: string }) {
  const { data, isLoading, error } = useTrace(id);
  if (isLoading) return <Loading label="Consultando linhas de origem e regras…" />;
  if (error) return <Callout tone="critical" icon="alert">{error.message}</Callout>;
  if (!data) return null;
  return (
    <div className="stack-lg">
      <div className="row wrap" style={{ gap: 10 }}>
        <span className="hash-chip"><Icon name="origin" />{id}</span>
        <span className="muted">{count(data.rows.length)} linhas de origem · {count(data.details.length)} regras de cálculo</span>
      </div>
      {data.rows.length ? (
        <div className="card table-wrap" style={{ maxHeight: 320 }}>
          <table className="table">
            <thead><tr><th>Arquivo de origem</th><th>Referência</th><th className="r">Linha</th><th className="r">Valor</th></tr></thead>
            <tbody>
              {data.rows.slice(0, 200).map((row, index) => (
                <tr key={`${row.ref_origem}-${index}`}>
                  <td className="mono">{row.arquivo_origem}</td>
                  <td className="mono">{row.ref_origem}</td>
                  <td className="r">{row.source_row ?? '—'}</td>
                  <td className="r"><Money value={row.valor} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.rows.length > 200 && <p className="muted" style={{ padding: 10, fontSize: 12 }}>Mostrando 200 de {count(data.rows.length)} linhas. O rastro completo está em rastro.csv.</p>}
        </div>
      ) : <Empty icon="origin" title="Sem contribuição em dinheiro">O item representa uma decisão ou exceção sem valor calculável.</Empty>}
      {data.details.slice(0, 12).map((detail, index) => <DetailCard key={`${detail.ref_origem}-${index}`} detail={detail} />)}
      {data.details.length > 12 && <p className="muted" style={{ fontSize: 12 }}>Mais {count(data.details.length - 12)} regras no rastro completo.</p>}
    </div>
  );
}
