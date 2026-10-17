import { describe, expect, it } from 'vitest';
import { cents, diffPercent, fromCents, sumMoney, toUnits } from './decimal';
import { money, moneyShort, percent, pp, periodShort, dateBR, cnpj } from './format';

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
  it('formats dates, periods and CNPJ', () => {
    expect(dateBR('2026-09-01')).toBe('01/09/2026');
    expect(periodShort('2026-09')).toBe('09/2026');
    expect(cnpj('00520815000100')).toBe('00.520.815/0001-00');
  });
});
