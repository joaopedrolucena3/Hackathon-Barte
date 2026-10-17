// Exact decimal arithmetic for the mock backend: amounts become integer cents, never floats.

/** "1234.56" → 123456n. Accepts up to `scale` fractional digits (extra digits are rejected). */
export function toUnits(value: string | number | null | undefined, scale = 2): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  const text = String(value).trim();
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) throw new Error(`Valor decimal inválido: ${text}`);
  const [, sign, whole = '', fraction = ''] = match;
  if (fraction.replace(/0+$/, '').length > scale) throw new Error(`Valor com mais de ${scale} casas: ${text}`);
  const units = BigInt((whole || '0') + fraction.padEnd(scale, '0').slice(0, scale));
  return sign ? -units : units;
}

/** 123456n → "1234.56" */
export function fromUnits(units: bigint, scale = 2): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const text = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  return negative ? `-${text}` : text;
}

export const cents = (value: string | number | null | undefined) => toUnits(value, 2);
export const fromCents = (units: bigint) => fromUnits(units, 2);

export function sumMoney(values: Iterable<string | number | null | undefined>): string {
  let total = 0n;
  for (const value of values) total += cents(value);
  return fromCents(total);
}

export function absUnits(units: bigint) {
  return units < 0n ? -units : units;
}

/** Difference between two percentage strings, in percentage points, exact to 6 places. */
export function diffPercent(applied: string, contracted: string): string {
  const text = fromUnits(toUnits(applied, 6) - toUnits(contracted, 6), 6).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

export function compareDecimal(a: string, b: string, scale = 6) {
  const x = toUnits(a, scale), y = toUnits(b, scale);
  return x === y ? 0 : x > y ? 1 : -1;
}
