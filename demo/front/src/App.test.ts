import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api/http';

const query = vi.hoisted(() => ({ state: vi.fn(), months: vi.fn(), runs: vi.fn() }));
vi.mock('./state/queries', () => ({ useAppState: query.state, useCompetencias: query.months, useRuns: query.runs, lastComp: (value: string) => value, useDataScope: () => ({ comp: '2026-10' }) }));
vi.mock('./components/Shell', () => ({ Shell: ({ children }: { children: React.ReactNode }) => createElement('div', { 'data-testid': 'application-shell' }, children) }));
import { App } from './App';

beforeEach(() => {
  query.state.mockReset(); query.months.mockReset(); query.runs.mockReset();
  query.state.mockReturnValue({ error: new ApiError('A execução ainda não produziu conferência', 409, { error: { code: 'RESULT_NOT_READY' } }) });
  query.months.mockReturnValue({ data: [{ comp: '2026-10', has_data: false, has_pack: true, current: true }] });
  query.runs.mockReturnValue({ data: [{ id: 'run-new', comp: '2026-10', status: 'running' }] });
});

describe('application navigation before financial results exist', () => {
  it('keeps the run route and its loading boundary mounted instead of blocking on global state', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/runs/run-new'] }, createElement(App)));
    expect(html).toContain('application-shell');
    expect(html).not.toContain('Não foi possível carregar o fechamento');
    expect(html).not.toContain('A execução ainda não produziu conferência');
    expect(query.state).not.toHaveBeenCalled();
  });
  it('opens the initial month from the catalog without asking for unready calculation results', () => {
    renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(App)));
    expect(query.months).toHaveBeenCalled();
    expect(query.state).not.toHaveBeenCalled();
  });
  it('resolves the latest run from its own list while calculation results are pending', () => {
    renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/runs?comp=2026-10'] }, createElement(App)));
    expect(query.runs).toHaveBeenCalledWith('2026-10');
    expect(query.state).not.toHaveBeenCalled();
  });
});
