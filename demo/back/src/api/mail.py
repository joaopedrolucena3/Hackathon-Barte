"""Local review API. Google credentials and authorization cookies never reach JSON."""
from __future__ import annotations

import html
from typing import Literal
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Body, Depends, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from ..mail.auth import AuthError
from ..pipeline.service import ServiceError

SESSION_COOKIE = 'tarvo_google_session'
BINDING_COOKIE = 'tarvo_google_oauth_binding'
COOKIE_PATH = '/api/mail'


class MailCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    issue_id: str = Field(min_length=1, max_length=200)


class MailEdit(BaseModel):
    model_config = ConfigDict(extra='forbid')
    version: int = Field(ge=1)
    to: str = Field(default='', max_length=320)
    subject: str | None = Field(default=None, min_length=1, max_length=998)
    body: str | None = Field(default=None, min_length=1, max_length=100000)
    refresh_evidence: bool = False
    counterparty: Literal['orbe', 'ponte'] | None = None
    counterparty_reason: str | None = Field(default=None, max_length=2000)


class MailApproval(BaseModel):
    model_config = ConfigDict(extra='forbid')
    version: int = Field(ge=1)
    content_hash: str = Field(pattern=r'^[a-f0-9]{64}$')


class CounterpartyContact(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: str = Field(max_length=320)
    name: str = Field(default='', max_length=160)
    enabled: bool = True
    id: str | None = Field(default=None, max_length=160)


def mail_router(mail, auth, store, actor_dependency):
    router = APIRouter(prefix='/api/mail', tags=['E-mails de pendências'])

    def account(request):
        return auth.status(request.cookies.get(SESSION_COOKIE))

    def sender(request):
        return account(request).get('connection')

    def authorized(request: Request):
        return auth.require_session(request.cookies.get(SESSION_COOKIE), request.headers.get('X-CSRF-Token'))

    def present(draft):
        if isinstance(draft, dict) and draft.get('id'):
            for attachment in draft.get('attachments', []):
                attachment['url'] = f"/api/mail/drafts/{quote(draft['id'], safe='')}/attachments/{quote(attachment['id'], safe='')}"
        return draft

    @router.get('/setup', response_class=HTMLResponse)
    def setup():
        source = Path(__file__).resolve().parents[2] / 'docs' / 'GMAIL.md'
        text = html.escape(source.read_text(encoding='utf-8'))
        return HTMLResponse('<!doctype html><html lang="pt-BR"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            '<title>Configurar Gmail · Tarvo</title><style>body{max-width:860px;margin:40px auto;padding:0 24px;color:#20343e;font:16px/1.6 system-ui}pre{white-space:pre-wrap;font:inherit}a{color:#8c442e}</style>'
            '<a href="/comunicacoes?aba=gmail">Voltar à plataforma</a><pre>' + text + '</pre></html>')

    @router.get('/account')
    def status(request: Request):
        return account(request)

    @router.post('/oauth/start')
    def connect(request: Request, body: dict = Body(...)):
        if body:
            raise ServiceError(422, 'INVALID_REQUEST', 'A conexão não recebe credenciais pelo navegador.')
        result = auth.begin()
        response = JSONResponse({'authorization_url': result['authorization_url']})
        response.set_cookie(BINDING_COOKIE, result['binding_cookie'], max_age=600,
                            httponly=True, samesite='lax', secure=request.url.scheme == 'https', path=COOKIE_PATH)
        return response

    @router.get('/oauth/callback')
    def callback(request: Request, state: str = '', code: str = '', error: str = ''):
        try:
            if error:
                raise AuthError(400, 'OAUTH_NOT_AUTHORIZED', 'A autorização Google não foi concluída. Conecte novamente quando desejar.')
            result = auth.complete(state, code, request.cookies.get(BINDING_COOKIE))
            response = RedirectResponse('/comunicacoes?aba=gmail', status_code=303)
            response.set_cookie(SESSION_COOKIE, result['session_token'], max_age=8*60*60,
                                httponly=True, samesite='lax', secure=request.url.scheme == 'https', path=COOKIE_PATH)
            context = auth.status(result['session_token']).get('connection') or {}
            with store.lock, store.db:
                store._audit('Conta Google autorizada', 'gmail_connected', {
                    'email': context.get('email'), 'sub': context.get('sub'),
                    'connection_id': context.get('connection_id'),
                    'identity_note': 'Conta autorizada; identidade individual do operador não verificada.'})
        except AuthError as exc:
            # No callback URL, authorization code, provider payload, or token in logs/HTML.
            response = HTMLResponse('<!doctype html><html lang="pt-BR"><meta charset="utf-8">'
                '<title>Conexão Gmail · Tarvo</title><main><h1>Conexão não concluída</h1><p>'
                + html.escape(exc.message) + '</p><a href="/comunicacoes?aba=gmail">Voltar à plataforma</a></main></html>',
                status_code=exc.status)
        except Exception:
            response = HTMLResponse('<!doctype html><html lang="pt-BR"><meta charset="utf-8">'
                '<title>Conexão Gmail · Tarvo</title><main><h1>Conexão não concluída</h1>'
                '<p>Não foi possível validar a autorização. Tente conectar novamente.</p>'
                '<a href="/comunicacoes?aba=gmail">Voltar à plataforma</a></main></html>', status_code=400)
        response.delete_cookie(BINDING_COOKIE, path=COOKIE_PATH)
        response.headers['Referrer-Policy'] = 'no-referrer'
        return response

    @router.post('/disconnect')
    def disconnect(body: dict = Body(...), context=Depends(authorized)):
        if body:
            raise ServiceError(422, 'INVALID_REQUEST', 'A desconexão não recebe credenciais.')
        result = auth.disconnect(context)
        with store.lock, store.db:
            store._audit('Conta Google autorizada', 'gmail_disconnected', {
                'email': context['email'], 'connection_id': context['connection_id']})
        response = JSONResponse(result or {'disconnected': True})
        response.delete_cookie(SESSION_COOKIE, path=COOKIE_PATH)
        return response

    @router.get('/contacts')
    def contacts():
        return {'contacts': mail.list_contacts()}

    @router.put('/contacts/{counterparty}')
    def contact(counterparty: Literal['orbe','ponte'], body: CounterpartyContact,
                actor: str = Depends(actor_dependency)):
        return mail.save_contact({**body.model_dump(exclude_none=True), 'counterparty': counterparty}, actor)

    @router.get('/drafts')
    def drafts(request: Request, issue_id: str | None = None):
        return {'drafts': [present(mail.get_draft(d['id'], sender(request))) for d in mail.list_drafts(issue_id)]}

    @router.post('/drafts', status_code=201)
    def create(request: Request, body: MailCreate, actor: str = Depends(actor_dependency)):
        return present(mail.create_draft(body.issue_id, actor, sender(request)))

    @router.get('/drafts/{draft_id}')
    def draft(draft_id: str, request: Request):
        return present(mail.get_draft(draft_id, sender(request)))

    @router.put('/drafts/{draft_id}')
    def edit(draft_id: str, request: Request, body: MailEdit, actor: str = Depends(actor_dependency)):
        return present(mail.save_draft(draft_id, body.model_dump(exclude_none=True, exclude_unset=True), actor, sender(request)))

    @router.post('/drafts/{draft_id}/approve-send')
    def send(draft_id: str, body: MailApproval, actor: str = Depends(actor_dependency), context=Depends(authorized)):
        result = mail.approve_send(draft_id, body.model_dump(), actor, context,
                                   lambda raw: auth.send_message(context, raw), provider_mode=auth.provider_mode)
        return present(result)

    @router.get('/drafts/{draft_id}/attachments/{attachment_id}')
    def attachment(draft_id: str, attachment_id: str, download: bool = False):
        meta, content = mail.attachment(draft_id, attachment_id)
        disposition = 'attachment' if download else 'inline'
        safe_name = quote(meta['name'], safe='')
        response = Response(content, media_type=meta['content_type'], headers={
            'Content-Disposition': f"{disposition}; filename*=UTF-8''{safe_name}",
            'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'})
        # Reports are static evidence. Do not grant them the origin's scripts or cookies.
        response.headers['Content-Security-Policy'] = "sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"
        return response

    @router.get('/issues/{issue_id}/history')
    def history(issue_id: str):
        return mail.history(issue_id)

    return router
