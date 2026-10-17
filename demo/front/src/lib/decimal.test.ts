import { describe, expect, it } from 'vitest';
import { cents, diffPercent, fromCents, sumMoney, toUnits } from './decimal';
import { money, moneyShort, percent, pp, periodShort, dateBR, cnpj, gerund, readable, shortRunId } from './format';

describe('decimal (mock backend arithmetic)', () => {
  it('keeps cents exact where floats drift', () => {
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
    expect(sumMoney(['207039.73', '39543.45'])).toBe('246583.18');
  });
  it('round-trips negative values', () => {
    expect(fromCents(cents('-5.50'))).toBe('-5.50');
    expect(fromCents(cents('-0.07'))).toBe('-0.07');
  });
  it('rejects more precision than the scale allows', () => {
    expect(() => toUnits('1.234', 2)).toThrow();
    expect(toUnits('1.2300', 2)).toBe(123n);
  });
  it('computes rate differences in percentage points', () => {
    expect(diffPercent('2.69', '0')).toBe('2.69');
    expect(diffPercent('1.500400', '1.4904')).toBe('0.01');
    expect(diffPercent('1.49', '1.59')).toBe('-0.1');
  });
});

describe('pt-BR formatting', () => {
  it('formats money, rates and percentage points', () => {
    expect(money('1234.56').replace(/\s/g, ' ')).toBe('R$ 1.234,56');
    expect(percent('2.69')).toBe('2,69%');
    expect(percent('1.4900')).toBe('1,49%');
    expect(pp('0.1')).toBe('+0,10 p.p.');
    expect(pp('-0.25')).toBe('−0,25 p.p.');
    expect(moneyShort('207039.73')).toBe('R$ 207,0 mil');
  });
  it('formats money from the decimal text, without float drift', () => {
    const plain = (text: string) => text.replace(/\s/g, ' ');
    expect(plain(money('4715852.69'))).toBe('R$ 4.715.852,69');
    expect(plain(money('123456789012345678.91'))).toBe('R$ 123.456.789.012.345.678,91');
    expect(plain(money('0.005'))).toBe('R$ 0,01');
    expect(plain(money('-0.005'))).toBe('-R$ 0,01');
    expect(plain(money('-0.001'))).toBe('R$ 0,00');
    expect(plain(money('-1234.5'))).toBe('-R$ 1.234,50');
    expect(pp('0')).toBe('0,00 p.p.');
  });
  it('formats dates, periods and CNPJ', () => {
    expect(dateBR('2026-09-01')).toBe('01/09/2026');
    expect(periodShort('2026-09')).toBe('09/2026');
    expect(cnpj('00520815000100')).toBe('00.520.815/0001-00');
  });
  it('speaks for the agent: gerund of the step, short run id, accented issue names', () => {
    expect(gerund('Conferir MDR')).toBe('Conferindo MDR');
    expect(gerund('Ler arquivos')).toBe('Lendo arquivos');
    expect(gerund('Normalizar Orbe')).toBe('Normalizando Orbe');
    expect(gerund('Aprovação humana')).toBe('Aprovação humana');
    expect(shortRunId('run-c2ada3efe4dd456199d767999a709fc3')).toBe('#c2ada3ef');
    expect(shortRunId('R-0001')).toBe('#R-0001');
    expect(readable('TRANSFERENCIA_EM_TRANSITO')).toBe('Transferência em trânsito');
    expect(readable('TAXA_SOBREPOSTA')).toBe('Vigências de taxa sobrepostas');
  });
});
