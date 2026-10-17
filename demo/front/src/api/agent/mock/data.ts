// Read-side of the mock backend: indexes the real /api/state so every mocked screen shows real numbers.
import { queryClient } from '../../../lib/queryClient';
import { core } from '../../core';
import type {
  AppState, BankEntry, Contract, Divergencia, Lancamento, Merchant, OrbeEntry, Pendencia, RemittanceEntry,
} from '../../types';

export const STATE_KEY = ['state'] as const;

export function loadState(): Promise<AppState> {
  return queryClient.fetchQuery({ queryKey: STATE_KEY, queryFn: core.state, staleTime: 15_000 });
}

export async function refreshState(): Promise<AppState> {
  await queryClient.invalidateQueries({ queryKey: STATE_KEY });
  return queryClient.fetchQuery({ queryKey: STATE_KEY, queryFn: core.state, staleTime: 0 });
}

export interface DataIndex {
  state: AppState;
  orbe: OrbeEntry[];
  orbeById: Map<string, OrbeEntry>;
  contractByTx: Map<string, Contract>;
  divergenceById: Map<string, Divergencia>;
  divergenceByRef: Map<string, Divergencia>;
  remittances: RemittanceEntry[];
  remittanceById: Map<string, RemittanceEntry>;
  remittanceRows: Map<string, number>;
  participationByOp: Map<string, string>;
  remDivergenceByRef: Map<string, Divergencia>;
  bankByRef: Map<string, BankEntry>;
  lancamentoByRef: Map<string, Lancamento>;
  merchantByCnpj: Map<string, Merchant>;
  merchantByEc: Map<string, Merchant>;
  pendenciasByRef: Map<string, Pendencia[]>;
  pendenciasByCnpj: Map<string, Pendencia[]>;
  stepOfPendencia: Map<string, string>;
}

const cache = new WeakMap<AppState, DataIndex>();

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
}

export function indexState(state: AppState): DataIndex {
  const cached = cache.get(state);
  if (cached) return cached;
  const r = state.results;
  const orbeById = new Map<string, OrbeEntry>();
  const contractByTx = new Map<string, Contract>();
  const remById = new Map<string, RemittanceEntry>();
  const remittanceRows = new Map<string, Set<number>>();
  const participationByOp = new Map<string, string>();
  const bankByRef = new Map<string, BankEntry>();

  for (const detail of r.details) {
    const entry = detail.entrada;
    if (!entry) continue;
    const file = detail.arquivo_origem || '';
    if (file.startsWith('01_')) {
      orbeById.set(entry.id, entry as OrbeEntry);
      if (detail.contract && !contractByTx.has(detail.ref_origem)) contractByTx.set(detail.ref_origem, detail.contract);
    } else if (file.startsWith('03_')) {
      if (!remById.has(entry.id)) remById.set(entry.id, entry as RemittanceEntry);
      const rows = remittanceRows.get(entry.id) || new Set<number>();
      if (entry.physical_row) rows.add(entry.physical_row);
      remittanceRows.set(entry.id, rows);
      if (detail.id_saida.startsWith('NF-') && detail.valor !== undefined) participationByOp.set(detail.ref_origem, detail.valor);
    } else if (file.startsWith('05')) {
      bankByRef.set(detail.ref_origem, entry as BankEntry);
    }
  }

  const divergenceById = new Map(r.divergencias.map(row => [row.id_saida, row]));
  const divergenceByRef = new Map<string, Divergencia>();
  const remDivergenceByRef = new Map<string, Divergencia>();
  for (const row of r.divergencias) (row.linha_negocio === 'REMESSA' ? remDivergenceByRef : divergenceByRef).set(row.ref_origem, row);

  const pendenciasByRef = new Map<string, Pendencia[]>();
  const pendenciasByCnpj = new Map<string, Pendencia[]>();
  const stepOfPendencia = new Map<string, string>();
  for (const p of r.pendencias) {
    push(pendenciasByRef, p.ref_origem, p);
    if (p.cnpj) push(pendenciasByCnpj, p.cnpj, p);
    stepOfPendencia.set(p.id_saida, stepFor(p, divergenceById));
  }

  const index: DataIndex = {
    state,
    orbe: [...orbeById.values()].sort((a, b) => (a.physical_row || 0) - (b.physical_row || 0)),
    orbeById,
    contractByTx,
    divergenceById,
    divergenceByRef,
    remittances: [...remById.values()].sort((a, b) => (a.physical_row || 0) - (b.physical_row || 0)),
    remittanceById: remById,
    remittanceRows: new Map([...remittanceRows].map(([id, rows]) => [id, Math.max(rows.size, 1)])),
    participationByOp,
    remDivergenceByRef,
    bankByRef,
    lancamentoByRef: new Map(r.lancamentos.map(row => [row.ref_origem, row])),
    merchantByCnpj: new Map(state.merchants.map(row => [row.cnpj, row])),
    merchantByEc: new Map(state.merchants.filter(row => row.ec).map(row => [String(row.ec), row])),
    pendenciasByRef,
    pendenciasByCnpj,
    stepOfPendencia,
  };
  cache.set(state, index);
  return index;
}

/** Which agent step raises each backend pendency. */
function stepFor(p: Pendencia, divergences: Map<string, Divergencia>): string {
  switch (p.tipo) {
    case 'DIVERGENCIA_TAXA':
      return divergences.get(p.divergence_id || '')?.linha_negocio === 'REMESSA' ? 'spread_remessa' : 'conferir_mdr';
    case 'CADASTRO_NAO_CONFIRMADO': case 'COMISSAO_NEGATIVA': case 'TAXA_NAO_ENCONTRADA': case 'CONTRATO_AUSENTE':
      return 'comissao_checkout';
    case 'SPREAD_NEGATIVO':
      return 'spread_remessa';
    case 'DUPLICIDADE':
      return 'duplicidade';
  }
  const file = p.evidence?.[0]?.arquivo || '';
  if (file.startsWith('05')) return 'classificar_bancos';
  if (file.startsWith('03')) return 'spread_remessa';
  return 'comissao_checkout';
}

export function merchantName(index: DataIndex, cnpj?: string, fallback = '') {
  return (cnpj && index.merchantByCnpj.get(cnpj)?.name) || fallback || (cnpj ? `CNPJ ${cnpj}` : '—');
}

/** Expected data-pack names for a competência (two reference files do not carry the month). */
export function expectedFiles(comp: string) {
  const [year, month] = comp.split('-');
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const token = `${months[Number(month) - 1] || month}${year}`;
  return [
    { prefix: '01_', name: `01_orbe_relatorio_comissoes_${token}.csv`, monthly: true },
    { prefix: '02_', name: '02_tabela_taxas_contratadas.xlsx', monthly: false },
    { prefix: '03_', name: `03_email_ponte_cambio_relatorio_${token}.eml`, monthly: true },
    { prefix: '04_', name: '04_plano_de_contas_fenix_erp.csv', monthly: false },
    { prefix: '05a_', name: `05a_extrato_banco_aurora_cc4471_${token}.csv`, monthly: true },
    { prefix: '05b_', name: `05b_extrato_banco_meridiano_cc90233_${token}.ofx`, monthly: true },
  ];
}

export function nextPeriod(period: string) {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
