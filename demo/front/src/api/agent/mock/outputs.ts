// Tabular output of each step (C8), derived from the engine results already in /api/state.
import { absUnits, cents, diffPercent, fromCents, toUnits } from '../../../lib/decimal';
import { productNames } from '../../../lib/format';
import type { OrbeEntry, Pendencia } from '../../types';
import type { ColumnSchema, ColumnType, ExceptionRef, ParamValue, PreviewRow } from '../contract';
import { merchantName, type DataIndex } from './data';

export interface StepOutput {
  schema: ColumnSchema[];
  rows: PreviewRow[];
  input_rows: number;
  /** Rows dropped by the step, shown struck through when comparing with the input. */
  removed?: PreviewRow[];
  extra?: Record<string, string | number>;
}

const col = (key: string, label: string, type: ColumnType = 'text', is_new = false): ColumnSchema => ({ key, label, type, is_new });

export const severityOf = (p: Pendencia) => (p.severity === 'bloqueante' ? 'bloqueante' : 'alerta') as ExceptionRef['severity'];

function exceptionFor(list: Pendencia[] | undefined): ExceptionRef | null {
  if (!list?.length) return null;
  const sorted = [...list].sort((a, b) => Number(b.severity === 'bloqueante') - Number(a.severity === 'bloqueante'));
  return { id: sorted[0].id_saida, severity: severityOf(sorted[0]), description: sorted[0].motivo, count: list.length };
}

function group(active: Pendencia[], key: (p: Pendencia) => string | undefined) {
  const map = new Map<string, Pendencia[]>();
  for (const p of active) {
    const k = key(p);
    if (!k) continue;
    const list = map.get(k);
    if (list) list.push(p); else map.set(k, [p]);
  }
  return map;
}

function productOf(entry: OrbeEntry, contractProduct?: string) {
  if (contractProduct) return contractProduct;
  if (entry.type?.includes('ANTECIPACAO')) return 'ANTECIPACAO';
  if (entry.modality === 'DEBITO') return 'DEBITO';
  if (entry.modality === 'PIX') return 'PIX';
  if (entry.modality === 'CREDITO A VISTA') return 'CREDITO_A_VISTA';
  if (entry.modality === 'CREDITO PARCELADO') return entry.installments > 6 ? 'CREDITO_7_12' : 'CREDITO_2_6';
  return '';
}

const productLabel = (code: string) => productNames[code] || code || '—';

/** Bank lines become balanced double entries for the Fênix ERP file. */
export function fenixEntries(index: DataIndex, excludedRefs: Set<string>) {
  return index.state.results.lancamentos
    .filter(line => !excludedRefs.has(line.ref_origem))
    .map(line => {
      const moneyIn = line.contrapartida_sentido === 'C';
      const amount = fromCents(absUnits(cents(line.valor)));
      return {
        _id: line.id_saida,
        data: line.data,
        historico: line.descricao,
        conta_debito: moneyIn ? line.conta_bancaria || '' : line.conta_codigo,
        conta_credito: moneyIn ? line.conta_codigo : line.conta_bancaria || '',
        valor: amount,
        banco: line.banco,
        origem: line.ref_origem,
      };
    });
}

export function buildOutput(
  type: string, index: DataIndex, params: Record<string, ParamValue>, active: Pendencia[], excludedRefs: Set<string> = new Set(),
): StepOutput | null {
  const { state } = index;
  const r = state.results;
  const sourceRows = (prefix: string) => state.sources.find(source => source.name.startsWith(prefix) && source.rows)?.rows || 0;

  switch (type) {
    case 'ler_arquivos': {
      const files = state.sources.filter(source => !source.embedded);
      return {
        schema: [col('arquivo', 'Arquivo'), col('formato', 'Formato'), col('linhas', 'Linhas lidas', 'number'), col('sha256', 'SHA-256', 'hash', true)],
        rows: state.sources.map(source => ({
          _id: source.name,
          arquivo: source.name,
          formato: source.embedded ? 'Anexo XLSX' : (source.name.split('.').pop() || '').toUpperCase(),
          linhas: source.rows ?? null,
          sha256: source.sha256,
        })),
        input_rows: files.length,
        extra: { arquivos: files.length, linhas: state.sources.reduce((sum, source) => sum + (source.rows || 0), 0) },
      };
    }

    case 'normalizar_orbe':
      return {
        schema: [col('id', 'Transação', 'code'), col('data', 'Data', 'date'), col('lojista', 'Lojista'), col('tipo', 'Tipo'),
          col('modalidade', 'Modalidade'), col('bruto', 'Bruto', 'money'), col('taxa_aplicada', 'Taxa aplicada', 'percent'),
          col('liquido', 'Líquido', 'money'), col('produto', 'Produto contratado', 'text', true), col('cnpj', 'CNPJ', 'code', true)],
        rows: index.orbe.map(entry => {
          const contract = index.contractByTx.get(entry.id);
          return {
            _id: entry.id, id: entry.id, data: entry.date, lojista: entry.name, tipo: entry.type, modalidade: entry.modality || '—',
            bruto: entry.gross, taxa_aplicada: entry.applied_rate_pct, liquido: entry.net,
            produto: productLabel(productOf(entry, contract?.product)),
            cnpj: contract?.cnpj || index.merchantByEc.get(String(entry.ec))?.cnpj || '',
          };
        }),
        input_rows: sourceRows('01_'),
      };

    case 'conferir_mdr': {
      const exceptions = group(active, p => p.ref_origem);
      const rows = index.orbe
        .filter(entry => index.contractByTx.has(entry.id))
        .map(entry => {
          const contract = index.contractByTx.get(entry.id)!;
          const divergence = index.divergenceByRef.get(entry.id);
          return {
            _id: entry.id, id: entry.id, data: entry.date, lojista: entry.name, produto: productLabel(contract.product),
            bruto: entry.gross, taxa_aplicada: entry.applied_rate_pct,
            taxa_contratada: contract.rate_pct,
            diferenca_pp: diffPercent(entry.applied_rate_pct || '0', contract.rate_pct || '0'),
            impacto_rs: divergence?.diferenca_brl ?? '0.00',
            _exception: exceptionFor(exceptions.get(entry.id)),
          };
        });
      return {
        schema: [col('id', 'Transação', 'code'), col('data', 'Data', 'date'), col('lojista', 'Lojista'), col('produto', 'Produto'),
          col('bruto', 'Bruto', 'money'), col('taxa_aplicada', 'Taxa aplicada', 'percent'),
          col('taxa_contratada', 'Taxa contratada', 'percent', true), col('diferenca_pp', 'Diferença', 'pp', true),
          col('impacto_rs', 'Impacto', 'money', true)],
        rows,
        input_rows: index.orbe.length,
        extra: { tolerancia_pp: String(params.tolerancia_pp ?? 0) },
      };
    }

    case 'estornos':
      return {
        schema: [col('id', 'Transação', 'code'), col('data', 'Data do movimento', 'date'), col('lojista', 'Lojista'), col('tipo', 'Tipo'),
          col('bruto', 'Bruto', 'money'), col('venda_original', 'Venda original', 'code', true),
          col('data_original', 'Data original', 'date', true), col('taxa_contratada', 'Taxa da data original', 'percent', true)],
        rows: index.orbe.filter(entry => entry.type !== 'VENDA').map(entry => ({
          _id: entry.id, id: entry.id, data: entry.date, lojista: entry.name, tipo: entry.type, bruto: entry.gross,
          venda_original: entry.original_id || '—', data_original: entry.original_date || '',
          taxa_contratada: index.contractByTx.get(entry.id)?.rate_pct ?? '',
        })),
        input_rows: index.orbe.length,
      };

    case 'comissao_checkout': {
      const exceptions = group(active, p => p.cnpj);
      const rows: PreviewRow[] = r.comissoes.filter(row => row.linha_negocio === 'CHECKOUT').map(row => ({
        _id: row.id_saida, lojista: row.lojista, cnpj: row.cnpj, origens: row.quantidade_origens ?? null,
        situacao: 'Calculada', comissao_brl: row.comissao_brl, _exception: exceptionFor(exceptions.get(row.cnpj)),
      }));
      const listed = new Set(rows.map(row => row.cnpj));
      for (const [cnpj, list] of exceptions) {
        if (listed.has(cnpj)) continue;
        rows.push({ _id: `pend-${cnpj}`, lojista: merchantName(index, cnpj), cnpj, origens: list.length,
          situacao: 'Fora da comissão · em revisão', comissao_brl: '0.00', _exception: exceptionFor(list) });
      }
      return {
        schema: [col('lojista', 'Lojista'), col('cnpj', 'CNPJ', 'code'), col('origens', 'Transações', 'number'),
          col('situacao', 'Situação', 'text', true), col('comissao_brl', 'Comissão', 'money', true)],
        rows,
        input_rows: index.orbe.length,
      };
    }

    case 'duplicidade': {
      const exceptions = group(active, p => p.ref_origem);
      const duplicated = new Set(r.pendencias.filter(p => p.tipo === 'DUPLICIDADE').map(p => p.ref_origem));
      const rows = index.remittances.map(entry => ({
        _id: entry.id, id: entry.id, data: entry.contracted_date, cliente: entry.name, moeda: entry.currency, valor_brl: entry.gross_brl,
        ocorrencias: Math.max(index.remittanceRows.get(entry.id) || 1, duplicated.has(entry.id) ? 2 : 1),
        _exception: exceptionFor(exceptions.get(entry.id)),
      }));
      return {
        schema: [col('id', 'Operação', 'code'), col('data', 'Data', 'date'), col('cliente', 'Cliente'), col('moeda', 'Moeda'),
          col('valor_brl', 'Valor', 'money'), col('ocorrencias', 'Linhas no relatório', 'number', true)],
        rows,
        removed: rows.filter(row => Number(row.ocorrencias) > 1).map(row => ({ ...row, _id: `${row._id}#dup`, _exception: null })),
        input_rows: state.sources.find(source => source.name.startsWith('03_') && source.embedded)?.rows
          || index.remittances.length + duplicated.size,
      };
    }

    case 'spread_remessa': {
      const exceptions = group(active, p => p.ref_origem);
      return {
        schema: [col('id', 'Operação', 'code'), col('data', 'Data', 'date'), col('cliente', 'Cliente'), col('moeda', 'Moeda'),
          col('valor_me', 'Valor em moeda estrangeira', 'number'), col('ptax', 'PTAX', 'number'), col('spread_brl', 'Spread realizado', 'money'),
          col('participacao_brl', `Participação (${params.participacao_pct ?? 50}%)`, 'money', true),
          col('diferenca_brl', 'Divergência contratual', 'money', true)],
        rows: index.remittances.map(entry => ({
          _id: entry.id, id: entry.id, data: entry.contracted_date, cliente: entry.name, moeda: entry.currency,
          valor_me: entry.foreign_amount, ptax: entry.ptax_rate, spread_brl: entry.spread_brl,
          participacao_brl: index.participationByOp.get(entry.id) ?? '0.00',
          diferenca_brl: index.remDivergenceByRef.get(entry.id)?.diferenca_brl ?? null,
          _exception: exceptionFor(exceptions.get(entry.id)),
        })),
        input_rows: index.remittances.length,
      };
    }

    case 'classificar_bancos': {
      const exceptions = group(active, p => p.ref_origem);
      return {
        schema: [col('banco', 'Banco'), col('data', 'Data', 'date'), col('descricao', 'Histórico'), col('valor', 'Valor', 'money'),
          col('conta_codigo', 'Conta Fênix', 'code', true), col('conta_descricao', 'Descrição da conta', 'text', true),
          col('metodo', 'Método', 'status', true), col('confianca', 'Confiança', 'number', true)],
        rows: r.lancamentos.map(line => ({
          _id: line.id_saida, banco: line.banco, data: line.data, descricao: line.descricao, valor: line.valor,
          conta_codigo: line.conta_codigo, conta_descricao: line.conta_descricao || '', metodo: line.metodo,
          confianca: line.confianca, _exception: exceptionFor(exceptions.get(line.ref_origem)),
        })),
        input_rows: r.lancamentos.length,
      };
    }

    case 'propor_notas':
      return {
        schema: [col('tomador', 'Tomador'), col('tomador_cnpj', 'CNPJ', 'code'), col('linha', 'Linha'),
          col('valor_brl', 'Valor da nota', 'money', true), col('discriminacao', 'Discriminação', 'text', true)],
        rows: r.notas.map(nota => ({
          _id: nota.id_saida, tomador: nota.tomador, tomador_cnpj: nota.tomador_cnpj,
          linha: nota.linha_negocio === 'REMESSA' ? 'Remessa' : 'Checkout', valor_brl: nota.valor_brl, discriminacao: nota.discriminacao,
        })),
        input_rows: r.comissoes.length,
      };

    case 'exportar_erp': {
      const rows = fenixEntries(index, excludedRefs);
      const total = rows.reduce((sum, row) => sum + toUnits(row.valor), 0n);
      return {
        schema: [col('data', 'Data', 'date'), col('historico', 'Histórico'), col('conta_debito', 'Débito', 'code', true),
          col('conta_credito', 'Crédito', 'code', true), col('valor', 'Valor', 'money', true), col('origem', 'Origem', 'code')],
        rows,
        input_rows: r.lancamentos.length,
        extra: { total_brl: fromCents(total) },
      };
    }

    default:
      return null;
  }
}

/** Stable content for the output hash: same inputs and parameters give the same hash (B6). */
export function canonicalRows(rows: PreviewRow[]) {
  return JSON.stringify(rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('_')))));
}
