"""Explicit demo messages with a durable claim before contacting the mail provider."""
from __future__ import annotations

from datetime import datetime, timezone
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import format_datetime
import hashlib
import json
from pathlib import Path
import sqlite3
import threading
import uuid

from ..pipeline.service import ServiceError
from .auth import KnownSendFailure
from .delivery import accepted_result
from .service import _actor, _email


def _now():
    return datetime.now(timezone.utc).isoformat()


class DemoMailService:
    def __init__(self, db_path, auth):
        self.auth, self.lock = auth, threading.RLock()
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(db_path), check_same_thread=False, timeout=15)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('CREATE TABLE IF NOT EXISTS demo_mail_deliveries (id TEXT PRIMARY KEY, content_hash TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL)')
        with self.db:
            for row in self.db.execute("SELECT data FROM demo_mail_deliveries WHERE status='sending'").fetchall():
                delivery = json.loads(row['data'])
                delivery.update(status='uncertain', finished_at=_now(), error={
                    'code': 'SEND_INTERRUPTED', 'message': 'O envio foi interrompido. Confira a caixa de e-mail antes de uma nova tentativa.'})
                self._save(delivery)

    def _save(self, delivery):
        self.db.execute('UPDATE demo_mail_deliveries SET status=?,data=? WHERE id=?',
                        (delivery['status'], json.dumps(delivery, ensure_ascii=False), delivery['id']))

    def deliveries(self):
        with self.lock:
            return [json.loads(row['data']) for row in self.db.execute('SELECT data FROM demo_mail_deliveries ORDER BY rowid DESC LIMIT 100')]

    def send(self, payload, context, actor):
        actor = _actor(actor)
        recipient = _email(payload.get('to'))
        if not recipient:
            raise ServiceError(422, 'INVALID_RECIPIENT', 'Informe um único e-mail válido para receber a mensagem.')
        if payload.get('counterparty') not in ('orbe', 'ponte'):
            raise ServiceError(422, 'INVALID_COUNTERPARTY', 'Selecione Orbe ou Ponte.')
        subject, body = payload.get('subject', '').strip(), payload.get('body', '').strip()
        if not subject or len(subject) > 998 or any(ord(c) < 32 for c in subject) or not body or len(body) > 100000:
            raise ServiceError(422, 'INVALID_MESSAGE', 'Preencha um assunto e uma mensagem válidos.')
        try:
            ident = str(uuid.UUID(str(payload.get('request_id', ''))))
        except ValueError:
            raise ServiceError(422, 'INVALID_REQUEST_ID', 'Atualize a tela para preparar uma nova mensagem.') from None
        content = {'sender': context['email'], 'connection_id': context['connection_id'],
                   'recipient': recipient, 'counterparty': payload['counterparty'], 'subject': subject, 'body': body}
        fingerprint = hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()
        with self.lock:
            self.db.execute('BEGIN IMMEDIATE')
            try:
                old = self.db.execute('SELECT content_hash,data FROM demo_mail_deliveries WHERE id=?', (ident,)).fetchone()
                if old:
                    if old['content_hash'] != fingerprint:
                        raise ServiceError(409, 'MESSAGE_ALREADY_CLAIMED', 'Esta tentativa já foi usada com outro conteúdo. Prepare uma nova mensagem.')
                    self.db.commit()
                    return json.loads(old['data'])
                delivery = {'id': ident, 'request_id': ident, **content, 'status': 'sending', 'created_at': _now(),
                            'actor': actor, 'provider_mode': self.auth.provider_mode}
                self.db.execute('INSERT INTO demo_mail_deliveries VALUES (?,?,?,?)',
                                (ident, fingerprint, 'sending', json.dumps(delivery, ensure_ascii=False)))
                self.db.commit()
            except BaseException:
                self.db.rollback()
                raise
        dispatched = False
        try:
            message = EmailMessage(policy=SMTP)
            message['From'], message['To'], message['Subject'] = context['email'], recipient, subject
            message['Date'] = format_datetime(datetime.now(timezone.utc))
            message['Message-ID'] = f'<tarvo-demo-{ident}@{context["email"].split("@")[-1]}>'
            message.set_content(body, charset='utf-8')
            raw = message.as_bytes()
            dispatched = True
            result = accepted_result(self.auth.send_message(context, raw))
            delivery.update(status='accepted', **result)
        except Exception as exc:
            known = not dispatched or isinstance(exc, KnownSendFailure)
            delivery.update(status='failed' if known else 'uncertain', error={
                'code': getattr(exc, 'code', 'SEND_FAILED' if known else 'SEND_UNCERTAIN'),
                'message': getattr(exc, 'message', 'O envio não foi realizado.' if known else 'Não foi possível confirmar o envio. Confira a caixa de e-mail; esta tentativa não será repetida.')})
        delivery['finished_at'] = _now()
        with self.lock, self.db:
            self._save(delivery)
        return delivery

    def close(self):
        with self.lock:
            self.db.close()
