// B6 + C8: the rows, rule, formula and contract behind one result, read from GET /api/trace.
import type { Detail, Provenance } from '../api/types';
import { cnpj, count, dateBR, money, percent, productNames, readable } from '../lib/format';
import { useTrace } from '../state/queries';
import { Icon } from './Icon';
import { Callout, Empty, HashChip, Loading, Money } from './ui';

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

function Origins({ rows }: { rows: Provenance[] }) {
  return <div className="stack" style={{ gap: 6 }}>{rows.map((origin, index) => <div key={`${origin.source_id || origin.source_sha256}-${index}`} className="row wrap" style={{ fontSize: 12 }}><span className="mono">{origin.source_file || 'Fonte histórica'}{origin.physical_row ? ` · linha ${origin.physical_row}` : ''}{origin.source_ref ? ` · ${origin.source_ref}` : ''}</span><HashChip hash={origin.source_sha256} size={12} /></div>)}</div>;
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
        ['Resultado', detail.valor === null ? 'Não calculado' : detail.valor !== undefined ? <Money value={detail.valor} /> : undefined],
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
      {!!e.provenances?.length && <details style={{ marginTop: 12 }}><summary>{count(e.provenances.length)} recebimentos da mesma operação</summary><p className="help">Estas são evidências adicionais. A contribuição financeira é contabilizada uma vez.</p><Origins rows={e.provenances} /></details>}
      {e.original_evidence && <section style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}><p className="strong">Operação original {e.original_resolution === 'historical' ? 'recuperada do histórico' : 'localizada nas entradas'}</p><Facts items={[["Referência", e.original_evidence.id], ["Data original", dateBR(e.original_evidence.date)], ["EC", e.original_evidence.ec], ["Natureza", readable(e.original_evidence.type || '')], ["Modalidade", readable(e.original_evidence.modality || '')], ["Parcelas", e.original_evidence.installments], ["Bandeira", e.original_evidence.brand], ["Bruto original", e.original_evidence.gross ? money(e.original_evidence.gross) : undefined], ["Reversões acumuladas", e.accumulated_reversal_brl ? money(e.accumulated_reversal_brl) : undefined]]} /><p className="help">O original compõe a evidência do vínculo; não é faturado novamente nesta competência.</p><Origins rows={e.original_evidence.provenances || [e.original_evidence]} /></section>}
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

export function TraceView({ id, compact }: { id: string; compact?: boolean }) {
  const { data, isLoading, error } = useTrace(id);
  if (isLoading) return <Loading label="Consultando linhas de origem e regras…" />;
  if (error) return <Callout tone="critical" icon="alert">{error.message}</Callout>;
  if (!data) return null;
  const details = compact ? data.details.slice(0, 1) : data.details.slice(0, 12);
  return (
    <div className="stack-lg">
      <div className="row wrap" style={{ gap: 10 }}>
        <span className="hash-chip"><Icon name="origin" />{id}</span>
        <span className="muted">{count(data.rows.length)} linhas de origem · {count(data.details.length)} regras de cálculo</span>
      </div>
      {data.rows.length ? (
        <div className="card table-wrap" style={{ maxHeight: compact ? 180 : 320 }}>
          <table className="table">
            <thead><tr><th>Arquivo de origem</th><th>Referência</th><th className="r">Linha</th><th className="r">Valor</th></tr></thead>
            <tbody>
              {data.rows.slice(0, 200).map((row, index) => (
                <tr key={`${row.ref_origem}-${index}`}>
                  <td className="mono">{row.arquivo_origem}</td>
                  <td className="mono">{row.ref_origem}</td>
                  <td className="r">{row.source_row ?? '—'}</td>
                  <td className="r">{row.valor === null ? 'Não calculado' : <Money value={row.valor} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.rows.length > 200 && <p className="muted" style={{ padding: 10, fontSize: 12 }}>Mostrando 200 de {count(data.rows.length)} linhas. O rastro completo está em rastro.csv.</p>}
        </div>
      ) : <Empty icon="origin" title="Sem contribuição em dinheiro">O item representa uma decisão ou exceção sem valor calculável.</Empty>}
      {details.map((detail, index) => <DetailCard key={`${detail.ref_origem}-${index}`} detail={detail} />)}
      {data.details.length > details.length && <p className="muted" style={{ fontSize: 12 }}>Mais {count(data.details.length - details.length)} regras no rastro completo.</p>}
    </div>
  );
}
