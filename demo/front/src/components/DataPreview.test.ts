import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PreviewPage } from '../api/agent';

const query = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock('../state/queries', () => ({ usePreview: query.preview }));
import { DataPreview } from './DataPreview';

function footer(totals: PreviewPage['totals']) {
  const page: PreviewPage = { step_id: 's3', state: 'ready', schema: [{ key: 'ref', label: 'Referência', type: 'text' }, { key: 'valor_brl', label: 'Valor', type: 'money' }],
    rows: [{ _id: '1', ref: 'OP-1', valor_brl: null }], page: 1, page_size: 100, total_rows: 1, totals };
  query.preview.mockReturnValue({ data: page });
  const html = renderToStaticMarkup(createElement(DataPreview, { runId: 'r1', stepId: 's3' }));
  return html.slice(html.indexOf('<tfoot>'), html.indexOf('</tfoot>'));
}

describe('preview totals with incomplete monetary values', () => {
  it('labels missing global and page totals as unavailable without substituting zero', () => {
    const html = footer({ all: {}, page: {} });
    expect(html.match(/Indisponível/g)).toHaveLength(2);
    expect(html).not.toContain('0,00');
  });

  it('keeps global and page availability independent', () => {
    const missingGlobal = footer({ all: {}, page: { valor_brl: '12.34' } });
    expect(missingGlobal.match(/Indisponível/g)).toHaveLength(1);
    expect(missingGlobal.indexOf('Indisponível')).toBeLessThan(missingGlobal.indexOf('página'));
    expect(missingGlobal).toContain('12,34');
    const missingPage = footer({ all: { valor_brl: '98.76' }, page: {} });
    expect(missingPage.match(/Indisponível/g)).toHaveLength(1);
    expect(missingPage.indexOf('Indisponível')).toBeGreaterThan(missingPage.indexOf('página'));
    expect(missingPage).toContain('98,76');
  });

  it('preserves a real zero total when explicitly supplied by the backend', () => {
    const html = footer({ all: { valor_brl: '0.00' }, page: { valor_brl: '0.00' } });
    expect(html.match(/0,00/g)).toHaveLength(2);
    expect(html).not.toContain('Indisponível');
  });
});
