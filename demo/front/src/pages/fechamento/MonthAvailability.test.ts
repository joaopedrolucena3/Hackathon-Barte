import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/http';
import { isUnstartedMonth, MonthSelector, UnstartedMonth } from './MonthAvailability';
const failure = (code: string, status = 404) => new ApiError('Inicie uma execução', status, { error: { code } });

describe('competência reconhecida sem cálculo', () => {
  it('keeps period-without-inputs launchable only when no immutable run was selected', () => {
    expect(isUnstartedMonth(failure('PERIOD_WITHOUT_INPUTS'))).toBe(true);
    expect(isUnstartedMonth(failure('PERIOD_WITHOUT_INPUTS'), 'run-antigo')).toBe(false);
    for (const code of ['RUN_PERIOD_MISMATCH', 'RUN_NOT_FOUND', 'RESULT_NOT_READY', 'INTERNAL_ERROR']) expect(isUnstartedMonth(failure(code, 422))).toBe(false);
    expect(isUnstartedMonth(new Error('Offline'))).toBe(false);
  });
  it('renders month navigation, launch and deadline actions without state or financial results', () => {
    const html = renderToStaticMarkup(createElement(Fragment, null,
      createElement(MonthSelector, { comp: '2026-10', months: [{ comp: '2026-09', has_data: true, current: false }, { comp: '2026-10', has_data: false, has_pack: true, current: false }], onChange() {} }),
      createElement(UnstartedMonth, { comp: '2026-10', hasPack: true, deadline: '2026-11-05', onLaunch() {}, onConfigure() {} })));
    expect(html).toContain('aria-label="Competência"');
    expect(html).toContain('value="2026-10" selected=""');
    expect(html).toContain('Outubro de 2026');
    expect(html).toContain('Calcular fechamento');
    expect(html).toContain('Prazo do mês');
    expect(html).toContain('05/11/2026');
    expect(html).toContain('arquivos disponíveis');
    expect(html).toContain('enviar arquivos ou indicar uma pasta');
    expect(html).not.toContain('R$');
    expect(html).not.toContain('Não foi possível');
  });
  it('allows upload/folder even when the server has not recognized a pack yet', () => {
    const html = renderToStaticMarkup(createElement(UnstartedMonth, { comp: '2027-01', onLaunch() {}, onConfigure() {} }));
    expect(html).toContain('Envie os arquivos do mês ou indique uma pasta');
    expect(html).not.toContain('foi reconhecido');
  });
});
