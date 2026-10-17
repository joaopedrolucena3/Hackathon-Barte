import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RecommendationPreview } from '../../api/agent/recommendations';
import { RecommendationEffects } from './RecommendationsTab';

describe('prévia financeira de sugestões', () => {
  it('keeps before/after and external follow-ups explicit instead of treating exposure as a financial change', () => {
    const preview = { effects: { entries_before: 2, entries_after: 2, debit_before: '20.00', debit_after: '20.00', credit_before: '20.00', credit_after: '20.00', balanced: true } } as RecommendationPreview;
    const html = renderToStaticMarkup(createElement(RecommendationEffects, { preview }));
    expect(html).toContain('Antes');
    expect(html).toContain('Após aplicar');
    expect(html).toContain('A aprovação e a exportação continuam na aba Revisão.');
    expect(html).toContain('continuam pendentes até haver evidência de conclusão');
    expect(html).toContain('não conclui essas tarefas nem envia mensagens');
  });
  it('does not turn unavailable legacy effects into zero amounts or an imbalance', () => {
    const preview = { snapshot_status: 'legacy_unavailable', effects: { entries_before: null, entries_after: null, debit_before: null, debit_after: null, credit_before: null, credit_after: null, balanced: null } } as RecommendationPreview;
    const html = renderToStaticMarkup(createElement(RecommendationEffects, { preview }));
    expect(html).toContain('Efeito no lote indisponível');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('exige revisão de balanceamento');
    expect(html).not.toContain('0,00');
  });
});
