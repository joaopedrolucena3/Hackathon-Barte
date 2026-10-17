// pt-BR display helpers. Values arrive as decimal strings from the backend and are only formatted here.
type Num = string | number | null | undefined;

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const integer = new Intl.NumberFormat('pt-BR');
const isBlank = (value: Num) => value === null || value === undefined || value === '';
const DECIMAL = /^(-)?(\d+)(?:\.(\d*))?$/;

/** pt-BR digits straight from the decimal text, never through a float. Rounds ROUND_HALF_UP like the backend. */
function exactDigits(value: Num, min: number, max: number) {
  const match = DECIMAL.exec(String(value).trim());
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  let units = BigInt(whole + fraction.slice(0, max).padEnd(max, '0'));
  if (fraction.length > max && fraction[max] >= '5') units += 1n;
  const digits = units.toString().padStart(max + 1, '0');
  const integerPart = max ? digits.slice(0, -max) : digits;
  let decimals = max ? digits.slice(-max) : '';
  while (decimals.length > min && decimals.endsWith('0')) decimals = decimals.slice(0, -1);
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return { negative: !!sign && units !== 0n, text: decimals ? `${grouped},${decimals}` : grouped };
}

export function money(value: Num) {
  if (isBlank(value)) return '—';
  const exact = exactDigits(value, 2, 2);
  if (exact) return `${exact.negative ? '-' : ''}R$ ${exact.text}`;
  return Number.isNaN(Number(value)) ? '—' : brl.format(Number(value));
}

/** Short form for chart labels and tiles: R$ 207,0 mil · R$ 1,2 mi. */
export function moneyShort(value: Num) {
  if (isBlank(value)) return '—';
  const n = Number(value), abs = Math.abs(n), sign = n < 0 ? '−' : '';
  const fmt = (v: number, d = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  if (abs >= 1e6) return `${sign}R$ ${fmt(abs / 1e6)} mi`;
  if (abs >= 1e4) return `${sign}R$ ${fmt(abs / 1e3)} mil`;
  return money(n);
}

export function count(value: Num) {
  return integer.format(Number(value || 0));
}

export function decimal(value: Num, min = 2, max = 4) {
  if (isBlank(value)) return '—';
  const exact = exactDigits(value, min, max);
  if (exact) return `${exact.negative ? '-' : ''}${exact.text}`;
  return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });
}

/** Rates are stored as percentages: "2.69" → "2,69%". */
export function percent(value: Num, min = 2, max = 4) {
  return isBlank(value) ? '—' : `${decimal(value, min, max)}%`;
}

/** Percentage-point difference with explicit sign: +0,10 p.p. */
export function pp(value: Num) {
  if (isBlank(value)) return '—';
  const text = String(value).trim();
  const magnitude = text.replace(/^-/, '');
  const sign = !/[1-9]/.test(magnitude) ? '' : text.startsWith('-') ? '−' : '+';
  return `${sign}${decimal(magnitude, 2, 4)} p.p.`;
}

export function dateBR(value: string | null | undefined) {
  if (!value) return '—';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso && value.length <= 10) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR');
}

export function dateTimeBR(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function timeBR(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** "2026-09" → "setembro de 2026" */
export function periodLong(period: string | null | undefined) {
  if (!period) return 'Competência não informada';
  const date = new Date(`${period}-15T12:00:00`);
  return Number.isNaN(date.getTime()) ? period : date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

/** "2026-09" → "09/2026" */
export function periodShort(period: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})$/.exec(period || '');
  return match ? `${match[2]}/${match[1]}` : period || '—';
}

export function capitalize(text: string) {
  return text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
}

export function cnpj(value: string | null | undefined) {
  if (!value) return '—';
  return value.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function duration(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 60_000) return `${decimal(ms / 1000, 1, 1)} s`;
  const minutes = Math.floor(ms / 60_000), seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} min ${seconds} s`;
}

export function bytes(size: number | null | undefined) {
  if (!size && size !== 0) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${decimal(size / 1024, 1, 1)} KB`;
  return `${decimal(size / 1024 ** 2, 1, 1)} MB`;
}

export function shortHash(hash: string | null | undefined, size = 6) {
  return hash ? `${hash.slice(0, size)}…` : '—';
}

/** run-c2ada3efe4dd… → #c2ada3ef: enough to tell runs apart on screen; the full id stays one click away. */
export function shortRunId(id: string) {
  return `#${id.replace(/^run-/, '').slice(0, 8)}`;
}

/** Step titles are infinitives ("Conferir MDR"); the agent's live line uses the gerund ("Conferindo MDR"). */
export function gerund(title: string) {
  const [verb, ...rest] = title.split(' ');
  const match = /^(.*)([aei])r$/i.exec(verb);
  if (!match) return title;
  return [`${match[1]}${{ a: 'ando', e: 'endo', i: 'indo' }[match[2].toLowerCase() as 'a' | 'e' | 'i']}`, ...rest].join(' ');
}

export function plural(n: number, one: string, many: string) {
  return `${count(n)} ${n === 1 ? one : many}`;
}

export const productNames: Record<string, string> = {
  DEBITO: 'Débito', CREDITO_A_VISTA: 'Crédito à vista', CREDITO_2_6: 'Crédito 2 a 6x', CREDITO_7_12: 'Crédito 7 a 12x',
  PIX: 'Pix', ANTECIPACAO: 'Antecipação', REMESSA: 'Remessa',
};

export const issueNames: Record<string, string> = {
  CADASTRO_NAO_CONFIRMADO: 'Cadastro não confirmado', COMISSAO_NEGATIVA: 'Comissão negativa',
  CREDITO_NAO_IDENTIFICADO: 'Crédito não identificado', DEVOLUCAO_REPASSE: 'Devolução de repasse',
  DIVERGENCIA_TAXA: 'Taxa cobrada diferente da contratada', DUPLICIDADE: 'Operação duplicada', SPREAD_NEGATIVO: 'Spread negativo',
  TRANSFERENCIA_EM_TRANSITO: 'Transferência em trânsito', TAXA_NAO_ENCONTRADA: 'Taxa não encontrada',
  CONTRATO_AUSENTE: 'Contrato ausente', CONFERIR_REPASSE_PONTE: 'Conferir repasse da Ponte',
  TAXA_SOBREPOSTA: 'Vigências de taxa sobrepostas', TAXA_AUSENTE: 'Taxa ausente', TAXA_INVALIDA: 'Taxa inválida',
  CADASTRO_AUSENTE: 'Lojista sem cadastro', CADASTRO_AMBIGUO: 'Cadastro ambíguo',
  CLASSIFICACAO_PENDENTE: 'Classificação bancária pendente', CONTA_NAO_ANALITICA: 'Conta contábil não analítica',
  CHECKOUT_INVALIDO: 'Transação de checkout inválida', LINHA_INVALIDA: 'Linha ilegível no arquivo',
  DUPLICIDADE_CONFLITANTE: 'Duplicidade com valores diferentes', DUPLICIDADE_INVALIDA: 'Duplicidade inválida',
  ORBE_CAMPOS_INVALIDOS: 'Campos inválidos no relatório da Orbe', COMPLIANCE_NAO_AUTORIZADO: 'Operação sem autorização de compliance',
  MAPA_CONTABIL_A_CONFIRMAR: 'Mapa contábil a confirmar', REMESSA_INVALIDA: 'Remessa inválida',
  SALDO_DIVERGENTE: 'Saldo bancário divergente', VALOR_INVALIDO: 'Valor inválido', BANCO_INVALIDO: 'Lançamento bancário inválido',
};

export function readable(code: string | null | undefined) {
  if (!code) return '—';
  return issueNames[code] || productNames[code] || capitalize(code.replaceAll('_', ' ').toLocaleLowerCase('pt-BR'));
}
