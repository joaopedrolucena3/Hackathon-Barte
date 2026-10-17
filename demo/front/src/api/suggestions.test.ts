import { afterEach, describe, expect, it, vi } from 'vitest';
import { mail, type MailAccount } from './mail';
import { canAuthorizeSuggestion, suggestionLabel, suggestionReviewKey, suggestions, type MailSuggestion } from './suggestions';

vi.mock('./http', () => ({ actorHeaders: async () => ({ 'X-User': encodeURIComponent('João revisão'), 'X-User-Encoding': 'percent-utf8' }) }));

const identity = { email: 'financeirotarvo@gmail.com', sub: 'gmail-account', connection_id: 'connection-1' };
const account: MailAccount = { configured: true, connected: true, authorized: true, connection: identity, email: identity.email, provider_mode: 'gmail_smtp', missing_config: [] };
const original: MailSuggestion = {
  id: 'suggestion-1', run_id: 'run-1', period: '2026-09', counterparty: 'orbe', kind: 'DIVERGENCIA_TAXA',
  title: 'Conferir taxa com Orbe', justification: 'A taxa informada difere da contratada.', recommended_action: 'Solicitar esclarecimento.', limitations: ['Exposição não equivale a valor a restituir.'],
  items: [{ id: 'issue-1', reference: 'checkout-1', reason: 'Taxas divergentes.', value_brl: '100.00' }], item_count: 1,
  to: 'financeirotarvo@gmail.com', subject: 'Conferência de taxas', body: 'Solicitamos esclarecimento conforme anexos.',
  status: 'suggested', version: 2, content_hash: 'a'.repeat(64), evidence_hash: 'evidence-1', sender: identity,
  attachments: [{ id: 'attachment-1', name: 'evidencias.csv', content_type: 'text/csv', size: 50, sha256: 'file-hash', url: '/evidence' }],
  blockers: [], created_at: '', updated_at: '',
};
const fields = { to: original.to, subject: original.subject, body: original.body };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('Permission for a saved suggestion', () => {
  it('only enables permission for the exact saved content and bound sender', () => {
    expect(canAuthorizeSuggestion(original, fields, account)).toBe(true);
    expect(canAuthorizeSuggestion(original, { ...fields, body: 'Texto ainda não salvo' }, account)).toBe(false);
    expect(canAuthorizeSuggestion(original, fields, { ...account, connection: { ...identity, connection_id: 'new-session' } })).toBe(false);
    expect(canAuthorizeSuggestion({ ...original, sender: null }, fields, account)).toBe(false);
    expect(canAuthorizeSuggestion(original, fields, { ...account, authorized: false })).toBe(false);
  });
  it.each(['dismissed', 'sending', 'sent', 'failed', 'uncertain'] as const)('requires a fresh saved review or blocks permission in %s state', status => {
    expect(canAuthorizeSuggestion({ ...original, status }, fields, account)).toBe(false);
  });
  it('blocks duplicate evidence and stale decisions', () => {
    expect(canAuthorizeSuggestion({ ...original, duplicate_of: 'sent-before' }, fields, account)).toBe(false);
    expect(canAuthorizeSuggestion({ ...original, blockers: [{ code: 'SUGGESTION_EVIDENCE_CHANGED', message: 'Ocorrência já resolvida.' }] }, fields, account)).toBe(false);
  });
  it.each([
    ['version', (draft: MailSuggestion) => { draft.version += 1; }],
    ['content', (draft: MailSuggestion) => { draft.content_hash = 'changed'; }],
    ['evidence', (draft: MailSuggestion) => { draft.evidence_hash = 'changed'; }],
    ['sender', (draft: MailSuggestion) => { draft.sender!.connection_id = 'changed'; }],
    ['attachment', (draft: MailSuggestion) => { draft.attachments[0].sha256 = 'changed'; }],
  ])('invalidates the checked permission when %s changes', (_, change) => {
    const updated = structuredClone(original); change(updated);
    expect(suggestionReviewKey(updated, fields)).not.toBe(suggestionReviewKey(original, fields));
  });
  it('invalidates permission when the recipient or unsaved text changes', () => {
    expect(suggestionReviewKey(original, { ...fields, to: 'other@example.com' })).not.toBe(suggestionReviewKey(original, fields));
    expect(suggestionReviewKey(original, { ...fields, body: 'Edited' })).not.toBe(suggestionReviewKey(original, fields));
  });
  it('does not label a test provider as a real send', () => {
    expect(suggestionLabel({ ...original, status: 'sent', provider_mode: 'injected_test' })).toContain('Simulado');
    expect(suggestionLabel({ ...original, status: 'sent', provider_mode: 'gmail_smtp' })).toBe('Aceito pelo servidor de e-mail');
  });
});

describe('Suggestion transport preserves explicit approval boundaries', () => {
  it('prepares and saves without calling any send endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ suggestions: [original] })).mockResolvedValueOnce(json({ ...original, version: 3 }));
    vi.stubGlobal('fetch', fetcher);
    await suggestions.prepare(original.run_id);
    await suggestions.save(original, fields);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/mail/suggestions/prepare', '/api/mail/suggestions/suggestion-1']);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ run_id: 'run-1' });
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ version: 2, ...fields });
  });
  it('refuses to call the server without explicit permission', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(suggestions.approve(original, false)).rejects.toThrow('permissão explícita');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('sends only the exact reviewed version/hash with session and analyst; never retries a lost response', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ ...account, csrf_token: 'csrf-memory' })).mockRejectedValueOnce(new TypeError('Connection interrupted'));
    vi.stubGlobal('fetch', fetcher);
    await mail.account();
    await expect(suggestions.approve(original, true)).rejects.toThrow('Connection interrupted');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe('/api/mail/suggestions/suggestion-1/approve-send');
    expect(fetcher.mock.calls[1][1].headers).toMatchObject({ 'X-CSRF-Token': 'csrf-memory', 'X-User': 'Jo%C3%A3o%20revis%C3%A3o' });
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ version: 2, content_hash: original.content_hash, permission: true });
  });
  it('regenerates evidence without sending stale edited text back', async () => {
    const fetcher = vi.fn().mockResolvedValue(json(original)); vi.stubGlobal('fetch', fetcher);
    await suggestions.refresh(original);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ version: 2, refresh_evidence: true });
  });
  it('preserves the selected run and records the reviewer refusal reason', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ suggestions: [original] })).mockResolvedValueOnce(json({ ...original, status: 'dismissed' })); vi.stubGlobal('fetch', fetcher);
    await suggestions.list('run/old');
    await suggestions.dismiss(original, 'Já esclarecido com o parceiro.');
    expect(fetcher.mock.calls[0][0]).toBe('/api/mail/suggestions?run_id=run%2Fold');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ version: 2, reason: 'Já esclarecido com o parceiro.' });
  });
});
