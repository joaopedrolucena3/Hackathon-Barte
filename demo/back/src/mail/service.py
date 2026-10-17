"""Reviewed external email, independent of the legacy simulation and close.

The caller must validate its authorized session before approve_send. The Google
identity and the analyst's declared name are recorded separately. Network work
starts only after a durable, atomic claim of the exact reviewed version.
"""
from __future__ import annotations

import copy
from contextlib import contextmanager
from datetime import datetime, timezone
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import format_datetime
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import threading
import uuid

from ..pipeline.service import ServiceError
from .evidence import attachments_for, build_evidence, canonical, digest, template


def _now(): return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _identity(value):
    if not value: return None
    if not isinstance(value, dict): raise ServiceError(422, "INVALID_SENDER", "Conta remetente inválida.")
    return {key: str(value.get(key, "")) for key in ("email", "sub", "connection_id")}


def _email(value):
    value = str(value or "").strip()
    if len(value) > 254 or not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}", value):
        return None
    return value


def _actor(value):
    value = str(value or "").strip()
    if not value or len(value) > 120 or any(ord(c) < 32 for c in value):
        raise ServiceError(422, "ACTOR_REQUIRED", "Informe o nome declarado do responsável (até 120 caracteres).")
    return value


def _content_hash(draft):
    keys = ("id", "issue_id", "period", "version", "sender", "counterparty", "counterparty_reason", "to", "subject", "body", "evidence_hash")
    content = {key: draft.get(key) for key in keys}
    content["attachments"] = [{key: row[key] for key in ("id", "name", "content_type", "size", "sha256")} for row in draft["attachments"]]
    return digest(content)


class MailService:
    def __init__(self, db_path, store):
        self.store, self.lock = store, threading.RLock()
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(db_path), check_same_thread=False, timeout=15, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=15000")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS mail_drafts(id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, period TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(issue_id,period));
          CREATE TABLE IF NOT EXISTS mail_versions(draft_id TEXT, version INTEGER, content_hash TEXT NOT NULL, snapshot TEXT NOT NULL, evidence TEXT NOT NULL, PRIMARY KEY(draft_id,version));
          CREATE TABLE IF NOT EXISTS mail_attachments(id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, version INTEGER NOT NULL, metadata TEXT NOT NULL, content BLOB NOT NULL);
          CREATE TABLE IF NOT EXISTS mail_attempts(id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, mime BLOB NOT NULL, UNIQUE(draft_id,version));
          CREATE TABLE IF NOT EXISTS mail_events(id INTEGER PRIMARY KEY AUTOINCREMENT, draft_id TEXT, issue_id TEXT, data TEXT NOT NULL);
        """)
        # A process interruption cannot prove whether Gmail accepted the message.
        with self._transaction():
            for row in self.db.execute("SELECT data FROM mail_drafts WHERE status='sending'").fetchall():
                draft = json.loads(row["data"])
                draft.update(status="uncertain", updated_at=_now(), error={"code": "SEND_INTERRUPTED", "message": "Envio interrompido; confira manualmente a pasta Enviados do Gmail. Não haverá repetição automática."})
                self._put(draft)
                attempt = self.db.execute("SELECT data,id FROM mail_attempts WHERE draft_id=? AND status='sending'", (draft["id"],)).fetchone()
                if attempt:
                    data = json.loads(attempt["data"]); data.update(status="uncertain", finished_at=_now(), error=draft["error"])
                    self.db.execute("UPDATE mail_attempts SET status='uncertain',data=? WHERE id=?", (canonical(data), attempt["id"]))
                self._event(draft, "send_uncertain", "Sistema", {"status": "uncertain", "error": draft["error"]})

    @contextmanager
    def _transaction(self):
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                yield
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    def _get(self, ident):
        row = self.db.execute("SELECT data FROM mail_drafts WHERE id=?", (ident,)).fetchone()
        if not row: raise ServiceError(404, "MAIL_DRAFT_NOT_FOUND", "Rascunho não encontrado.")
        return json.loads(row["data"])

    def _put(self, draft):
        self.db.execute("INSERT INTO mail_drafts VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,version=excluded.version,data=excluded.data", (draft["id"], draft["issue_id"], draft["period"], draft["status"], draft["version"], canonical(draft)))

    def _event(self, draft, kind, actor, detail=None):
        event = {"type": kind, "at": _now(), "actor": actor, "declared_actor": actor, "version": draft["version"], "status": draft["status"], "draft_id": draft["id"], "issue_id": draft["issue_id"], **(detail or {})}
        self.db.execute("INSERT INTO mail_events(draft_id,issue_id,data) VALUES (?,?,?)", (draft["id"], draft["issue_id"], canonical(event)))
        return event

    def _audit(self, actor, action, detail):
        with self.store.lock, self.store.db:
            self.store._audit(actor, "external_mail_" + action, detail)

    def list_contacts(self):
        with self.store.lock:
            return [c for c in self.store.records("contacts") if c.get("kind") == "counterparty"]

    def save_contact(self, payload, actor):
        actor = _actor(actor)
        if not isinstance(payload, dict): raise ServiceError(422, "INVALID_CONTACT", "Informe um contato.")
        party = payload.get("counterparty")
        if party not in {"orbe", "ponte"}: raise ServiceError(422, "INVALID_COUNTERPARTY", "Selecione Orbe ou Ponte.")
        email = _email(payload.get("email"))
        if not email: raise ServiceError(422, "INVALID_RECIPIENT", "Cadastre um único endereço de e-mail válido, sem nome ou lista de destinatários.")
        if not isinstance(payload.get("enabled", True), bool): raise ServiceError(422, "INVALID_CONTACT", "O campo enabled deve ser verdadeiro ou falso.")
        name = str(payload.get("name", "")).strip()
        if len(name) > 160 or any(ord(c) < 32 for c in name): raise ServiceError(422, "INVALID_CONTACT", "Nome do contato inválido.")
        ident = str(payload.get("id") or "counterparty-" + party)
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", ident): raise ServiceError(422, "INVALID_CONTACT", "Identificador do contato inválido.")
        with self.store.lock, self.store.db:
            old = next((c for c in self.store.records("contacts") if c.get("id") == ident), None)
            if old and old.get("kind") != "counterparty": raise ServiceError(409, "CONTACT_KIND_CONFLICT", "Este contato pertence a outro fluxo e será preservado.")
            contact = {"id": ident, "kind": "counterparty", "counterparty": party, "name": name, "email": email, "enabled": payload.get("enabled", True), "updated_at": _now(), "updated_by": actor}
            self.store.db.execute("INSERT OR REPLACE INTO contacts VALUES (?,?)", (ident, canonical(contact)))
            self.store._audit(actor, "external_mail_contact_saved", {"before": old, "after": contact})
        return contact

    def _recipient(self, party):
        contacts = [c for c in self.list_contacts() if c.get("counterparty") == party and c.get("enabled") and _email(c.get("email"))]
        if len(contacts) != 1:
            return "", {"code": "CONTACT_MISSING" if not contacts else "CONTACT_AMBIGUOUS", "message": "Cadastre e ative um contato para a contraparte." if not contacts else "Há mais de um contato ativo para esta contraparte; revise o cadastro."}
        return contacts[0]["email"], None

    def _save_version(self, draft, evidence, files):
        draft["attachments"] = []
        for item in files:
            ident = "attachment-" + uuid.uuid4().hex
            metadata = {"id": ident, **{key: item[key] for key in ("name", "content_type", "size", "sha256")}, "url": f"/api/mail/drafts/{draft['id']}/attachments/{ident}"}
            self.db.execute("INSERT INTO mail_attachments VALUES (?,?,?,?,?)", (ident, draft["id"], draft["version"], canonical(metadata), item["data"]))
            draft["attachments"].append(metadata)
        draft["content_hash"] = _content_hash(draft)
        self.db.execute("INSERT INTO mail_versions VALUES (?,?,?,?,?)", (draft["id"], draft["version"], draft["content_hash"], canonical(draft), canonical(evidence)))
        self._put(draft)

    def _decorate(self, draft, sender=None):
        draft = copy.deepcopy(draft)
        blockers = []
        try:
            current = build_evidence(self.store, draft["issue_id"], draft.get("counterparty"), draft.get("counterparty_reason", ""))
            stale = current["evidence_hash"] != draft["evidence_hash"]
            blockers += current["blockers"]
        except ServiceError as exc:
            stale = True
            blockers.append({"code": "ISSUE_CHANGED", "message": "A pendência não está mais disponível nesta competência. O conteúdo salvo permanece no histórico."})
        if stale: blockers.append({"code": "EVIDENCE_CHANGED", "message": "Os dados relacionados mudaram. Atualize as evidências e revise o novo conteúdo antes de aprovar."})
        current_sender = _identity(sender)
        if not current_sender or not _email(current_sender.get("email")):
            blockers.append({"code": "GMAIL_DISCONNECTED", "message": "Conecte a conta Gmail de teste para enviar."})
        elif current_sender != draft.get("sender"):
            blockers.append({"code": "SENDER_CHANGED", "message": "A conta conectada mudou. Salve uma nova versão e revise o remetente antes de aprovar."})
        if draft.get("counterparty"):
            _, error = self._recipient(draft["counterparty"])
            if error: blockers.append(error)
        if not _email(draft.get("to")): blockers.append({"code": "RECIPIENT_REQUIRED", "message": "Revise o destinatário: informe um único endereço válido."})
        if not str(draft.get("subject", "")).strip() or not str(draft.get("body", "")).strip(): blockers.append({"code": "CONTENT_REQUIRED", "message": "Revise assunto e corpo antes do envio."})
        state = draft["status"]
        if state in {"sent", "uncertain", "sending"}: blockers.append({"code": "SEND_LOCKED", "message": "Esta mensagem já foi enviada ou pode ter sido aceita. Não é permitido repetir o envio."})
        elif state == "failed": blockers.append({"code": "REVIEW_AFTER_FAILURE", "message": "A falha foi confirmada. Revise e salve uma nova versão antes de outra aprovação."})
        draft.update(stale=stale, blockers=blockers, current_sender=current_sender)
        return draft

    def list_drafts(self, issue_id=None):
        with self.lock:
            query, args = ("SELECT data FROM mail_drafts WHERE issue_id=? ORDER BY rowid DESC", (issue_id,)) if issue_id else ("SELECT data FROM mail_drafts ORDER BY rowid DESC", ())
            return [json.loads(row["data"]) for row in self.db.execute(query, args)]

    def get_draft(self, ident, sender=None):
        with self.lock: return self._decorate(self._get(ident), sender)

    def create_draft(self, issue_id, actor, sender=None):
        actor = _actor(actor)
        evidence = build_evidence(self.store, issue_id)
        created = False
        with self._transaction():
            old = self.db.execute("SELECT id FROM mail_drafts WHERE issue_id=? AND period=?", (issue_id, evidence["period"])).fetchone()
            if old: ident = old["id"]
            else:
                ident = "mail-" + uuid.uuid4().hex
                recipient, _ = self._recipient(evidence["counterparty"])
                subject, body = template(evidence)
                draft = {"id": ident, "issue_id": issue_id, "period": evidence["period"], "counterparty": evidence["counterparty"], "counterparty_reason": "", "to": recipient, "subject": subject, "body": body,
                         "version": 1, "sender": _identity(sender), "evidence_hash": evidence["evidence_hash"], "issue": evidence["issue"], "status": "draft", "created_at": _now(), "created_by": actor, "updated_at": _now(), "updated_by": actor}
                self._save_version(draft, evidence, attachments_for(evidence))
                event = self._event(draft, "draft_created", actor, {"content_hash": draft["content_hash"], "evidence_hash": draft["evidence_hash"]})
                created = True
        if created: self._audit(actor, "draft_created", event)
        return self.get_draft(ident, sender)

    def save_draft(self, ident, payload, actor, sender=None):
        actor = _actor(actor)
        if not isinstance(payload, dict): raise ServiceError(422, "INVALID_DRAFT", "Informe os campos do rascunho.")
        with self._transaction():
            draft = self._get(ident)
            if draft["status"] not in {"draft", "failed"}: raise ServiceError(409, "MAIL_NOT_EDITABLE", "Mensagem enviada, em andamento ou com resultado incerto não pode ser alterada.")
            if payload.get("version") != draft["version"]: raise ServiceError(409, "MAIL_VERSION_CONFLICT", "O rascunho mudou. Reabra a revisão antes de salvar.")
            before = copy.deepcopy(draft)
            party = payload.get("counterparty", draft.get("counterparty"))
            reason = str(payload.get("counterparty_reason", draft.get("counterparty_reason", ""))).strip()
            current = build_evidence(self.store, draft["issue_id"], party, reason)
            if any(b["code"] == "COUNTERPARTY_MISMATCH" for b in current["blockers"]):
                raise ServiceError(422, "COUNTERPARTY_MISMATCH", "A contraparte escolhida não corresponde às operações da pendência.")
            refresh = payload.get("refresh_evidence", False)
            if not isinstance(refresh, bool): raise ServiceError(422, "INVALID_DRAFT", "refresh_evidence deve ser verdadeiro ou falso.")
            routing_changed = party != draft.get("counterparty") or reason != draft.get("counterparty_reason", "")
            if routing_changed: refresh = True
            if refresh:
                evidence, files = current, attachments_for(current)
                draft.update(evidence_hash=evidence["evidence_hash"], issue=evidence["issue"], counterparty=evidence["counterparty"], counterparty_reason=reason)
                draft["subject"], draft["body"] = template(evidence)
                if routing_changed or not draft.get("to"): draft["to"] = self._recipient(evidence["counterparty"])[0]
            else:
                old = self.db.execute("SELECT evidence FROM mail_versions WHERE draft_id=? AND version=?", (ident, draft["version"])).fetchone()
                evidence = json.loads(old["evidence"])
                files = []
                for item in draft["attachments"]:
                    data = self.db.execute("SELECT content FROM mail_attachments WHERE id=?", (item["id"],)).fetchone()["content"]
                    files.append({**item, "data": data})
            for key, limit in (("to", 254), ("subject", 500), ("body", 100000)):
                if key not in payload: continue
                value = payload[key]
                if not isinstance(value, str) or len(value) > limit or (key != "body" and any(c in value for c in "\r\n")) or "\x00" in value:
                    raise ServiceError(422, "INVALID_DRAFT", f"Campo {key} inválido ou acima do limite.")
                draft[key] = value.strip()
            if draft.get("to") and not _email(draft["to"]): raise ServiceError(422, "INVALID_RECIPIENT", "Informe um único endereço de e-mail válido.")
            draft.update(version=draft["version"] + 1, sender=_identity(sender), status="draft", updated_at=_now(), updated_by=actor)
            for key in ("error", "approval", "sent_at", "provider_message_id", "provider_thread_id", "attempt_id"): draft.pop(key, None)
            self._save_version(draft, evidence, files)
            event = self._event(draft, "draft_saved", actor, {"before_version": before["version"], "content_hash": draft["content_hash"], "evidence_refreshed": refresh})
        self._audit(actor, "draft_saved", event)
        return self.get_draft(ident, sender)

    def attachment(self, ident, attachment_id):
        with self.lock:
            self._get(ident)
            row = self.db.execute("SELECT metadata,content FROM mail_attachments WHERE draft_id=? AND id=?", (ident, attachment_id)).fetchone()
            if not row: raise ServiceError(404, "MAIL_ATTACHMENT_NOT_FOUND", "Anexo não encontrado nesta mensagem.")
            metadata, content = json.loads(row["metadata"]), bytes(row["content"])
            if hashlib.sha256(content).hexdigest() != metadata["sha256"]: raise ServiceError(409, "MAIL_ATTACHMENT_CHANGED", "A cópia do anexo foi alterada; envio bloqueado.")
            return metadata, content

    def _mime(self, draft, at):
        message = EmailMessage(policy=SMTP)
        message["From"], message["To"], message["Subject"] = draft["sender"]["email"], draft["to"], draft["subject"]
        message["Date"] = format_datetime(datetime.fromisoformat(at))
        message["Message-ID"] = f"<{draft['id']}.v{draft['version']}@tarvo.invalid>"
        message.set_content(draft["body"], charset="utf-8")
        for item in draft["attachments"]:
            metadata, content = self.attachment(draft["id"], item["id"])
            if any(metadata.get(key) != item.get(key) for key in ("id", "name", "content_type", "size", "sha256")):
                raise ServiceError(409, "MAIL_ATTACHMENT_CHANGED", "O anexo diverge da versão revisada; envio bloqueado.")
            if len(content) != item["size"] or hashlib.sha256(content).hexdigest() != item["sha256"]:
                raise ServiceError(409, "MAIL_ATTACHMENT_CHANGED", "Os bytes do anexo divergem da versão revisada; envio bloqueado.")
            main, sub = metadata["content_type"].split("/", 1)
            message.add_attachment(content, maintype=main, subtype=sub, filename=metadata["name"])
        if message.is_multipart(): message.set_boundary(f"tarvo-{draft['id']}-v{draft['version']}")
        return message.as_bytes()

    def approve_send(self, ident, payload, actor, auth_context, send_callable):
        actor = _actor(actor)
        identity = _identity(auth_context)
        if not identity or not all(identity.values()) or not _email(identity["email"]):
            raise ServiceError(401, "MAIL_AUTH_REQUIRED", "Uma sessão Google autorizada no servidor é necessária para aprovar o envio.")
        if not callable(send_callable): raise ServiceError(503, "MAIL_PROVIDER_UNAVAILABLE", "Provedor de envio indisponível.")
        leased = False
        try:
            with self._transaction():
                draft = self._get(ident)
                if draft["status"] != "draft": raise ServiceError(409, "MAIL_SEND_LOCKED", "Esta versão já foi tentada ou não está disponível para envio. Confira o histórico.")
                if payload.get("version") != draft["version"] or payload.get("content_hash") != draft["content_hash"]:
                    raise ServiceError(409, "MAIL_APPROVAL_MISMATCH", "A aprovação não corresponde à versão exibida. Reabra a revisão.")
                if _content_hash(draft) != draft["content_hash"]: raise ServiceError(409, "MAIL_CONTENT_CHANGED", "O conteúdo salvo diverge de seu hash; envio bloqueado.")
                # Always acquire SQLite's claim before Store. Keep this lease through
                # OAuth refresh and Gmail POST so normal financial edits cannot race.
                self.store.lock.acquire(); leased = True
                review = self._decorate(draft, identity)
                if review["blockers"]: raise ServiceError(409, "MAIL_REVIEW_REQUIRED", "Resolva os bloqueios e revise o conteúdo antes de aprovar.", review["blockers"])
                at, attempt_id = _now(), "attempt-" + uuid.uuid4().hex
                raw = self._mime(draft, at)
                approval = {"at": at, "declared_actor": actor, "google_account": identity, "identity_note": "Nome declarado pelo analista; a conta Google autoriza a sessão e pode ser compartilhada.", "version": draft["version"], "content_hash": draft["content_hash"], "evidence_hash": draft["evidence_hash"]}
                attempt = {"id": attempt_id, "draft_id": ident, "version": draft["version"], "status": "sending", "started_at": at, "approval": approval, "mime_sha256": hashlib.sha256(raw).hexdigest(), "approved_content": copy.deepcopy(draft)}
                try: self.db.execute("INSERT INTO mail_attempts VALUES (?,?,?,?,?,?)", (attempt_id, ident, draft["version"], "sending", canonical(attempt), raw))
                except sqlite3.IntegrityError as exc: raise ServiceError(409, "MAIL_SEND_LOCKED", "Esta versão já possui uma tentativa registrada; não será reenviada.") from exc
                draft.update(status="sending", approval=approval, attempt_id=attempt_id, updated_at=at)
                self._put(draft)
                event = self._event(draft, "send_approved", actor, {"attempt_id": attempt_id, "google_account": identity, "content_hash": draft["content_hash"], "mime_sha256": attempt["mime_sha256"]})
            dispatched = False
            try:
                # Exact MIME is durable before the only provider invocation.
                self._audit(actor, "send_approved", event)
                current = build_evidence(self.store, draft["issue_id"], draft.get("counterparty"), draft.get("counterparty_reason", ""))
                if current["evidence_hash"] != draft["evidence_hash"]:
                    raise ServiceError(409, "MAIL_EVIDENCE_CHANGED", "As evidências mudaram antes do envio. Atualize o rascunho e revise novamente.")
                dispatched = True
                response = send_callable(raw)
                if not isinstance(response, dict) or not isinstance(response.get("id"), str) or not response["id"].strip():
                    raise ValueError("Provider did not confirm a message ID")
                status, error = "sent", None
                provider = {"provider_message_id": response["id"], "provider_thread_id": response.get("threadId")}
            except Exception as exc:
                status = "failed" if not dispatched or getattr(exc, "outcome", None) == "known_failure" else "uncertain"
                provider = {}
                error = {"code": str(getattr(exc, "code", "SEND_UNCERTAIN" if status == "uncertain" else "SEND_FAILED")),
                         "message": str(getattr(exc, "message", "Não foi possível confirmar o resultado. Confira manualmente a pasta Enviados do Gmail; o envio não será repetido." if status == "uncertain" else "O envio não foi realizado. Revise antes de uma nova aprovação."))}
        finally:
            # Release before another mail transaction: another approval may be
            # holding SQLite while waiting for Store. This order prevents deadlock.
            if leased: self.store.lock.release()
        with self._transaction():
            draft = self._get(ident)
            draft.update(status=status, updated_at=_now(), **provider)
            if error: draft["error"] = error
            if status == "sent": draft["sent_at"] = _now()
            attempt.update(status=status, finished_at=_now(), **provider)
            if error: attempt["error"] = error
            self.db.execute("UPDATE mail_attempts SET status=?,data=? WHERE id=?", (status, canonical(attempt), attempt_id))
            self._put(draft)
            event = self._event(draft, "send_" + status, actor, {"attempt_id": attempt_id, "google_account": identity, **provider, **({"error": error} if error else {}), "delivery_note": "Aceito pelo Gmail; entrega e leitura não foram confirmadas." if status == "sent" else ""})
        self._audit(actor, "send_" + status, event)
        return self.get_draft(ident, identity)

    def history(self, issue_id):
        with self.lock:
            return [{"id": row["id"], **json.loads(row["data"])} for row in self.db.execute("SELECT id,data FROM mail_events WHERE issue_id=? ORDER BY id", (issue_id,))]

    def close(self):
        with self.lock: self.db.close()
