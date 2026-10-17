import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptedMailLabel, mail, matchesReviewedVersion, type MailDraft } from './mail';

vi.mock('./http', () => ({ actorHeaders: async () => ({ 'X-User': encodeURIComponent('João revisão'), 'X-User-Encoding': 'percent-utf8' }) }));

const original: MailDraft = {
  id: 'mail-1', issue_id: 'issue-1', period: '2026-09', counterparty: 'orbe',
  to: 'orbe@example.com', subject: 'Revisão', body: 'Confira a divergência.', version: 1,
  content_hash: 'a'.repeat(64), evidence_hash: 'evidence-1',
  sender: { email: 'demo@example.com', sub: 'google-1', connection_id: 'connection-1' },
  status: 'draft', stale: false, blockers: [], created_at: '', updated_at: '',
  attachments: [{ id: 'attachment-1', name: 'evidencias.html', content_type: 'text/html', size: 123, sha256: 'evidence-hash', url: '/attachment' }],
};
const fields = { to: original.to, subject: 'Texto revisado', body: original.body };
const saved = (): MailDraft => ({ ...structuredClone(original), ...fields, version: 2, content_hash: 'b'.repeat(64) });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('Approval of the reviewed Gmail version', () => {
  it('accepts the reviewed text and equivalent attachments with new storage IDs', () => {
    const result = saved();
    result.attachments[0].id = 'new-storage-id';
    result.attachments[0].url = '/new-version-attachment';
    expect(matchesReviewedVersion(original, result, fields)).toBe(true);
  });
  it.each([
    ['sender', (draft: MailDraft) => { draft.sender!.connection_id = 'another-connection'; }],
    ['evidence', (draft: MailDraft) => { draft.evidence_hash = 'new-evidence'; }],
    ['attachment bytes', (draft: MailDraft) => { draft.attachments[0].sha256 = 'changed'; }],
    ['attachment name', (draft: MailDraft) => { draft.attachments[0].name = 'different.html'; }],
    ['recipient', (draft: MailDraft) => { draft.to = 'another@example.com'; }],
    ['returned text', (draft: MailDraft) => { draft.body = 'Texto diferente'; }],
    ['version', (draft: MailDraft) => { draft.version = 3; }],
    ['hash', (draft: MailDraft) => { draft.content_hash = ''; }],
    ['stale evidence', (draft: MailDraft) => { draft.stale = true; }],
    ['blocker', (draft: MailDraft) => { draft.blockers = [{ code: 'CONTACT_MISSING', message: 'Sem contato' }]; }],
    ['in-progress send', (draft: MailDraft) => { draft.status = 'sending'; }],
  ])('requires another review after a change to %s', (_, mutate) => {
    const result = saved(); mutate(result);
    expect(matchesReviewedVersion(original, result, fields)).toBe(false);
  });
  it('does not label old or test-provider records as real Gmail sends', () => {
    expect(acceptedMailLabel({ ...original, status: 'sent' })).toBe('Aceito pelo provedor');
    expect(acceptedMailLabel({ ...original, provider_mode: 'injected_test', status: 'sent' })).toBe('Aceito pelo provedor de teste');
    expect(acceptedMailLabel({ ...original, provider_mode: 'gmail', status: 'sent' })).toBe('Aceito pelo Gmail');
  });
});

describe('Gmail API transport', () => {
  it('keeps CSRF in memory and passes UTF-8 actor headers without extra body fields', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ configured: true, connected: true, authorized: true, csrf_token: 'session-csrf', provider_mode: 'injected_test', missing_config: [] })).mockResolvedValueOnce(json(original));
    vi.stubGlobal('fetch', fetcher);
    const account = await mail.account();
    expect(account).not.toHaveProperty('csrf_token');
    await mail.create(original.issue_id);
    const [url, options] = fetcher.mock.calls[1];
    expect(url).toBe('/api/mail/drafts');
    expect(options.credentials).toBe('same-origin');
    expect(options.headers).toMatchObject({ 'X-User': 'Jo%C3%A3o%20revis%C3%A3o', 'X-User-Encoding': 'percent-utf8', 'X-CSRF-Token': 'session-csrf' });
    expect(JSON.parse(options.body)).toEqual({ issue_id: 'issue-1' });
  });
  it('sends exactly the server-returned version and hash, without retrying a lost response', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Connection interrupted'));
    vi.stubGlobal('fetch', fetcher);
    await expect(mail.approveSend(saved())).rejects.toThrow('Connection interrupted');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ version: 2, content_hash: 'b'.repeat(64) });
  });
  it('clears the previous CSRF when the session is no longer authorized', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ connected: false, authorized: false, configured: false, provider_mode: 'gmail', missing_config: [] })).mockResolvedValueOnce(json(original));
    vi.stubGlobal('fetch', fetcher);
    await mail.account(); await mail.create(original.issue_id);
    expect(fetcher.mock.calls[1][1].headers).not.toHaveProperty('X-CSRF-Token');
  });
  it('surfaces structured backend blockers and rejects non-JSON success responses', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ error: { code: 'MAIL_REVIEW_REQUIRED', message: 'Revise antes de enviar.', details: [{ code: 'CONTACT_MISSING', message: 'Cadastre um contato.' }] } }, 409)).mockResolvedValueOnce(new Response('<html>Proxy error</html>'));
    vi.stubGlobal('fetch', fetcher);
    await expect(mail.approveSend(saved())).rejects.toThrow('Revise antes de enviar. Cadastre um contato.');
    await expect(mail.drafts()).rejects.toThrow('Não foi possível confirmar');
  });
});
