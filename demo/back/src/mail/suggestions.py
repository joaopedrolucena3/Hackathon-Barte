"""Justified run-scoped suggestions; only explicit approval can contact Gmail.

Preparation has no authorization capability and never sends. Each approved MIME
and its exact review are committed before provider I/O. Uncertain outcomes and
semantic duplicates remain locked across runs, restarts and browser sessions.
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
import sqlite3
import threading
import uuid

from ..pipeline.service import ServiceError
from .delivery import accepted_result
from .evidence import canonical, digest
from .service import _actor, _email, _identity
from .suggestion_evidence import attachment_files, collect, describe, evidence_bundle, snapshot


DEFAULT_RECIPIENT = "financeirotarvo@gmail.com"
LOCKED = {"sending", "sent", "uncertain"}


def _now(): return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _content_hash(item):
    keys = ("id", "run_id", "version", "period", "counterparty", "kind", "sender", "to", "recipient_basis", "subject", "body", "evidence_hash", "semantic_hash", "title", "justification", "recommended_action", "limitations", "items", "attachments", "source_evidence_hash", "excluded_sent_count")
    return digest({key: item.get(key) for key in keys})


def _delivery_key(item):
    sender = item.get("sender") or {}
    if not sender.get("email") or not item.get("to"): return None
    return digest([item["semantic_hash"], sender["email"].lower(), item["to"].lower()])


def _item_delivery_key(semantic_hash, sender, recipient):
    return digest([semantic_hash, sender["email"].lower(), recipient.lower()])


class SuggestionService:
    def __init__(self, db_path, flow, mail, auth):
        self.flow, self.mail, self.auth = flow, mail, auth
        self.lock = threading.RLock()
        self._closed = False
        self._group_cache = {}
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(db_path), check_same_thread=False, timeout=15, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=15000")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS mail_suggestions(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,group_key TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(run_id,group_key));
          CREATE TABLE IF NOT EXISTS mail_suggestion_versions(suggestion_id TEXT,version INTEGER,content_hash TEXT NOT NULL,data TEXT NOT NULL,evidence TEXT NOT NULL,PRIMARY KEY(suggestion_id,version));
          CREATE TABLE IF NOT EXISTS mail_suggestion_attachments(id TEXT PRIMARY KEY,suggestion_id TEXT NOT NULL,version INTEGER NOT NULL,metadata TEXT NOT NULL,content BLOB NOT NULL);
          CREATE TABLE IF NOT EXISTS mail_suggestion_attempts(id TEXT PRIMARY KEY,suggestion_id TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,mime BLOB NOT NULL,UNIQUE(suggestion_id,version));
          CREATE TABLE IF NOT EXISTS mail_suggestion_claims(delivery_key TEXT PRIMARY KEY,suggestion_id TEXT NOT NULL,attempt_id TEXT NOT NULL,status TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS mail_suggestion_item_claims(delivery_key TEXT PRIMARY KEY,suggestion_id TEXT NOT NULL,attempt_id TEXT NOT NULL,status TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS mail_suggestion_runs(run_id TEXT PRIMARY KEY,data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS mail_suggestion_events(id INTEGER PRIMARY KEY AUTOINCREMENT,suggestion_id TEXT NOT NULL,data TEXT NOT NULL);
        """)
        with self._transaction():
            for row in self.db.execute("SELECT data FROM mail_suggestions WHERE status='sending'").fetchall():
                item = json.loads(row["data"])
                item.update(status="uncertain", updated_at=_now(), error={"code": "SEND_INTERRUPTED", "message": "O envio foi interrompido. Confira a pasta Enviados; esta contestação não será repetida."})
                self._put(item)
                for attempt_row in self.db.execute("SELECT data FROM mail_suggestion_attempts WHERE suggestion_id=? AND status='sending'", (item["id"],)).fetchall():
                    attempt = json.loads(attempt_row["data"])
                    attempt.update(status="uncertain", finished_at=_now(), error=item["error"])
                    self.db.execute("UPDATE mail_suggestion_attempts SET status='uncertain',data=? WHERE id=?", (canonical(attempt), attempt["id"]))
                self.db.execute("UPDATE mail_suggestion_claims SET status='uncertain' WHERE suggestion_id=? AND status='sending'", (item["id"],))
                self.db.execute("UPDATE mail_suggestion_item_claims SET status='uncertain' WHERE suggestion_id=? AND status='sending'", (item["id"],))
                self._event(item, "send_uncertain", "Sistema")
            # Existing durable attempts remain protected when this feature gains
            # finer-grained deduplication. Rebuild item claims from saved evidence,
            # never from today's financial data or mutable drafts.
            for row in self.db.execute("SELECT data FROM mail_suggestion_attempts WHERE status IN ('sending','sent','uncertain')").fetchall():
                attempt = json.loads(row["data"])
                approved = attempt["approved_content"]
                version = self.db.execute("SELECT evidence FROM mail_suggestion_versions WHERE suggestion_id=? AND version=?", (attempt["suggestion_id"], attempt["version"])).fetchone()
                if not version: continue
                bundle = json.loads(version["evidence"])
                hashes = evidence_bundle((bundle["counterparty"], bundle["period"], bundle["kind"]), bundle["evidence"])["item_hashes"]
                for fingerprint in hashes.values():
                    key = _item_delivery_key(fingerprint, approved["sender"], approved["to"])
                    self.db.execute("INSERT OR IGNORE INTO mail_suggestion_item_claims VALUES(?,?,?,?)", (key, attempt["suggestion_id"], attempt["id"], attempt["status"]))

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
        row = self.db.execute("SELECT data FROM mail_suggestions WHERE id=?", (ident,)).fetchone()
        if not row: raise ServiceError(404, "SUGGESTION_NOT_FOUND", "Sugestão não encontrada.")
        return json.loads(row["data"])

    def _put(self, item):
        self.db.execute("INSERT INTO mail_suggestions VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data", (item["id"], item["run_id"], item["group_key"], item["status"], canonical(item)))

    def _event(self, item, action, actor, **fields):
        data = {"action": action, "at": _now(), "actor": actor, "declared_actor": actor, "version": item["version"], "run_id": item["run_id"], "content_hash": item["content_hash"], **fields}
        self.db.execute("INSERT INTO mail_suggestion_events(suggestion_id,data) VALUES(?,?)", (item["id"], canonical(data)))

    def _recipient(self, party):
        contacts = [c for c in self.mail.list_contacts() if c.get("counterparty") == party and c.get("enabled") and _email(c.get("email"))]
        if len(contacts) > 1:
            return "", "ambiguous", [{"code": "CONTACT_AMBIGUOUS", "message": "Há mais de um contato ativo para esta contraparte; escolha um contato no cadastro antes de enviar."}]
        if contacts: return contacts[0]["email"], "contact", []
        return DEFAULT_RECIPIENT, "demo", []

    def _save_version(self, item, bundle, files):
        item["attachments"] = []
        for file in files:
            ident = "suggestion-file-" + uuid.uuid4().hex
            meta = {"id": ident, **{key: file[key] for key in ("name", "content_type", "size", "sha256")}, "url": f"/api/mail/suggestions/{item['id']}/attachments/{ident}"}
            self.db.execute("INSERT INTO mail_suggestion_attachments VALUES(?,?,?,?,?)", (ident, item["id"], item["version"], canonical(meta), file["data"]))
            item["attachments"].append(meta)
        item["content_hash"] = _content_hash(item)
        self.db.execute("INSERT INTO mail_suggestion_versions VALUES(?,?,?,?,?)", (item["id"], item["version"], item["content_hash"], canonical(item), canonical(bundle)))
        self._put(item)

    def _groups(self, run_id):
        run, context, adapter = snapshot(self.flow, run_id)
        # snapshot() always validates actual input/output bytes before a cache
        # lookup. Decisions/references/effective parameters also invalidate it.
        output_metadata = run.get("datasets", {})
        fingerprint = digest({"datasets": {name: meta["sha256"] for name, meta in output_metadata.items()} if output_metadata else context["datasets"],
                              "exceptions": context["exceptions"], "references": context.get("references", {}), "history": context.get("history_checkout", []),
                              "parameters": run["snapshot"].get("effective_parameters", {}), "period": run["competencia"],
                              "steps": [{key: step.get(key) for key in ("id", "type", "status")} for step in run.get("steps", [])]})
        cached = self._group_cache.get(run_id)
        if cached and cached[0] == fingerprint: return run, cached[1], cached[2]
        groups, excluded = collect(run, context, adapter)
        bundles = {digest(key): evidence_bundle(key, values) for key, values in groups.items()}
        self._group_cache[run_id] = (fingerprint, bundles, excluded)
        while len(self._group_cache) > 8: self._group_cache.pop(next(iter(self._group_cache)))
        return run, bundles, excluded

    def _duplicate_items(self, item, bundle=None):
        sender = item.get("sender")
        if not sender or not _email(item.get("to")): return []
        hashes = bundle["item_hashes"] if bundle else {row["id"]: row.get("semantic_hash") for row in item["items"]}
        duplicates = []
        for ident, fingerprint in hashes.items():
            if not fingerprint: continue
            key = _item_delivery_key(fingerprint, sender, item["to"])
            row = self.db.execute("SELECT suggestion_id,status FROM mail_suggestion_item_claims WHERE delivery_key=? AND status IN ('sending','sent','uncertain')", (key,)).fetchone()
            if row and row["suggestion_id"] != item["id"]:
                duplicates.append({"id": ident, "duplicate_of": row["suggestion_id"], "status": row["status"]})
        return duplicates

    @staticmethod
    def _scoped_bundle(current, item):
        included = {entry["id"] for entry in item["items"]}
        evidence = [entry for entry in current["evidence"] if entry["issue"]["id_saida"] in included]
        return evidence_bundle((current["counterparty"], current["period"], current["kind"]), evidence)

    def prepare(self, run_id, actor="Sistema"):
        actor = _actor(actor)
        with self.flow.lock:
            try: run, groups, excluded = self._groups(run_id)
            except ServiceError as exc:
                if exc.code not in {"RUN_EVIDENCE_UNAVAILABLE", "DATASET_CHANGED", "INPUT_CHANGED", "RUN_REFERENCE_CHANGED"}: raise
                summary = {"run_id": run_id, "prepared_at": _now(), "excluded": [], "unavailable": {"code": exc.code, "message": exc.message}}
                with self._transaction(): self.db.execute("INSERT OR REPLACE INTO mail_suggestion_runs VALUES(?,?)", (run_id, canonical(summary)))
                return self.list(run_id)
            with self._transaction():
                for group_key, bundle in groups.items():
                    row = self.db.execute("SELECT data FROM mail_suggestions WHERE run_id=? AND group_key=?", (run_id, group_key)).fetchone()
                    if row:
                        # Preserve dismissed/sent versions and human edits. A changed
                        # decision set must be refreshed explicitly by the reviewer.
                        continue
                    description = describe(bundle)
                    recipient, basis, _ = self._recipient(bundle["counterparty"])
                    at = _now()
                    item = {"id": "suggestion-" + uuid.uuid4().hex, "run_id": run_id, "group_key": group_key,
                            "period": run["competencia"], "counterparty": bundle["counterparty"], "kind": bundle["kind"],
                            **description, "status": "suggested", "version": 1, "evidence_hash": bundle["evidence_hash"], "semantic_hash": bundle["semantic_hash"],
                            "source_evidence_hash": bundle["evidence_hash"], "excluded_sent_count": 0,
                            "to": recipient, "recipient_basis": basis, "sender": None, "created_at": at, "updated_at": at, "created_by": actor,
                            "requires_permission": True, "run_is_test": bool(run.get("draft"))}
                    self._save_version(item, bundle, attachment_files(bundle, description))
                    self._event(item, "suggestion_prepared", actor)
                summary = {"run_id": run_id, "prepared_at": _now(), "excluded": excluded, "eligible_groups": len(groups)}
                self.db.execute("INSERT OR REPLACE INTO mail_suggestion_runs VALUES(?,?)", (run_id, canonical(summary)))
            return self.list(run_id)

    def run_summary(self, run_id):
        with self.lock:
            row = self.db.execute("SELECT data FROM mail_suggestion_runs WHERE run_id=?", (run_id,)).fetchone()
            return json.loads(row["data"]) if row else {"run_id": run_id, "prepared_at": None, "excluded": []}

    def on_run(self, run):
        if self._closed or not isinstance(run, dict) or run.get("status") not in {"awaiting_approval", "done"}: return None
        return self.prepare(run["id"])

    def _decorate(self, item, groups=None, error=None):
        result = copy.deepcopy(item)
        blockers = []
        current = (groups or {}).get(item["group_key"])
        stale = bool(error or not current or current["evidence_hash"] != item.get("source_evidence_hash", item["evidence_hash"])
                     or self._scoped_bundle(current, item)["evidence_hash"] != item["evidence_hash"])
        if stale:
            blockers.append({"code": getattr(error, "code", "SUGGESTION_EVIDENCE_CHANGED"), "message": getattr(error, "message", "As pendências abertas ou evidências mudaram. Atualize a sugestão e revise a nova versão antes de autorizar.")})
        recipient, basis, contact_errors = self._recipient(item["counterparty"])
        blockers += contact_errors
        if item["recipient_basis"] in {"demo", "contact", "ambiguous"} and (recipient != item["to"] or basis != item["recipient_basis"]):
            blockers.append({"code": "RECIPIENT_CHANGED", "message": "O contato sugerido mudou. Salve e revise o destinatário antes de autorizar."})
        if not _email(item.get("to")): blockers.append({"code": "RECIPIENT_REQUIRED", "message": "Informe um único e-mail válido para receber a mensagem."})
        if not item.get("sender"): blockers.append({"code": "SENDER_REVIEW_REQUIRED", "message": "Conecte o Gmail e salve a sugestão para revisar o remetente antes de autorizar."})
        if any(not entry.get("semantic_hash") for entry in item["items"]): blockers.append({"code": "SUGGESTION_REFRESH_REQUIRED", "message": "Salve uma nova versão para revisar a identificação das evidências antes de autorizar."})
        if item["status"] in LOCKED: blockers.append({"code": "SUGGESTION_SEND_LOCKED", "message": "Esta contestação já foi enviada ou pode ter sido aceita; não haverá repetição."})
        elif item["status"] == "failed": blockers.append({"code": "SUGGESTION_REAPPROVAL_REQUIRED", "message": "Revise e salve uma nova versão antes de autorizar outra tentativa."})
        elif item["status"] == "dismissed": blockers.append({"code": "SUGGESTION_DISMISSED", "message": "Esta sugestão foi dispensada pelo responsável."})
        key = _delivery_key(item)
        duplicate = self.db.execute("SELECT suggestion_id,status FROM mail_suggestion_claims WHERE delivery_key=? AND status IN ('sending','sent','uncertain')", (key,)).fetchone() if key else None
        if duplicate and duplicate["suggestion_id"] != item["id"]:
            result["duplicate_of"] = duplicate["suggestion_id"]
            blockers.append({"code": "SUGGESTION_ALREADY_SENT", "message": "Estas mesmas evidências já possuem um envio para este destinatário e remetente, inclusive em outra execução."})
        repeated = self._duplicate_items(item)
        result["already_sent_count"] = len(repeated)
        if repeated:
            result["duplicate_of"] = repeated[0]["duplicate_of"]
            partial = len(repeated) < item["item_count"]
            code = "SUGGESTION_PARTIALLY_SENT" if partial else "SUGGESTION_ALREADY_SENT"
            if not any(blocker["code"] == code for blocker in blockers):
                blockers.append({"code": code, "message": (f"{len(repeated)} ocorrência(s) já possuem envio para este remetente e destinatário. Atualize a sugestão para manter apenas as novas evidências e revise a nova versão." if partial else "Todas as ocorrências já possuem envio confirmado ou incerto para este remetente e destinatário. O conteúdo permanece apenas para consulta; não será reenviado.")})
        result.update(blockers=blockers, stale=stale)
        return result

    def list(self, run_id=None):
        with self.flow.lock, self.lock:
            rows = self.db.execute("SELECT data FROM mail_suggestions" + (" WHERE run_id=?" if run_id else "") + " ORDER BY rowid DESC", (run_id,) if run_id else ()).fetchall()
            cached, result = {}, []
            for row in rows:
                item = json.loads(row["data"])
                if item["run_id"] not in cached:
                    try: cached[item["run_id"]] = (self._groups(item["run_id"])[1], None)
                    except ServiceError as exc: cached[item["run_id"]] = ({}, exc)
                groups, error = cached[item["run_id"]]
                result.append(self._decorate(item, groups, error))
            return result

    def get(self, ident):
        with self.flow.lock, self.lock:
            item = self._get(ident)
            try: groups, error = self._groups(item["run_id"])[1], None
            except ServiceError as exc: groups, error = {}, exc
            return self._decorate(item, groups, error)

    def edit(self, ident, payload, actor, sender=None):
        actor = _actor(actor)
        if not isinstance(payload, dict): raise ServiceError(422, "INVALID_SUGGESTION", "Informe a versão e as alterações para revisão.")
        with self.flow.lock, self._transaction():
            item = self._get(ident)
            if item["status"] in LOCKED or item["status"] == "dismissed": raise ServiceError(409, "SUGGESTION_NOT_EDITABLE", "Esta sugestão está encerrada ou possui envio em andamento ou incerto.")
            if payload.get("version") != item["version"]: raise ServiceError(409, "SUGGESTION_VERSION_MISMATCH", "A sugestão mudou. Reabra a revisão antes de salvar.")
            _, groups, _ = self._groups(item["run_id"])
            full = groups.get(item["group_key"])
            if not full: raise ServiceError(409, "SUGGESTION_NO_LONGER_ACTIONABLE", "Não restam ocorrências abertas e elegíveis neste grupo.")
            changed = full["evidence_hash"] != item.get("source_evidence_hash", item["evidence_hash"])
            if changed and payload.get("refresh_evidence") is not True:
                raise ServiceError(409, "SUGGESTION_EVIDENCE_CHANGED", "Atualize as evidências e revise o novo conteúdo antes de salvar.")
            if "to" in payload and payload["to"] is not None:
                if not isinstance(payload["to"], str): raise ServiceError(422, "INVALID_RECIPIENT", "Informe um único endereço de e-mail válido.")
                item["to"] = payload["to"].strip()
            if not _email(item["to"]): raise ServiceError(422, "INVALID_RECIPIENT", "Informe um único endereço de e-mail válido.")
            recommended, basis, _ = self._recipient(item["counterparty"])
            item["recipient_basis"] = basis if item["to"] == recommended else "manual"
            if sender is not None:
                identity = _identity(sender)
                if not identity or not all(identity.values()) or not _email(identity["email"]): raise ServiceError(422, "INVALID_SENDER", "A conta remetente não está disponível para revisão.")
                item["sender"] = identity
            repeated = self._duplicate_items(item, full)
            repeated_ids = {entry["id"] for entry in repeated}
            remaining = [entry for entry in full["evidence"] if entry["issue"]["id_saida"] not in repeated_ids]
            # Keep an entirely repeated group visible and blocked, never turn it
            # into an empty message. A partial repeat becomes a new delta review.
            bundle = evidence_bundle((full["counterparty"], full["period"], full["kind"]), remaining) if remaining and repeated else full
            filtered = bool(remaining and repeated)
            selection_changed = bundle["evidence_hash"] != item["evidence_hash"]
            regenerated = changed or selection_changed or payload.get("refresh_evidence") is True
            description = describe(bundle)
            if filtered:
                description["limitations"].append(f"{len(repeated)} ocorrência(s) com envio já confirmado ou incerto foram retiradas; esta versão contém somente as evidências ainda não enviadas para este remetente e destinatário.")
            if regenerated: item.update(description)
            else:
                item.update({key: value for key, value in description.items() if key not in {"subject", "body"}})
            # When the selection changes, an old form must not put removed
            # occurrences back into the generated message. Return the new text
            # for a separate review/edit instead of applying that stale form.
            if not regenerated:
                for key in ("subject", "body"):
                    if key in payload and payload[key] is not None:
                        if not isinstance(payload[key], str): raise ServiceError(422, "INVALID_SUGGESTION", "Assunto e mensagem devem ser textos.")
                        item[key] = payload[key].strip()
            if not item["subject"] or len(item["subject"]) > 998 or any(ord(c) < 32 for c in item["subject"]) or not item["body"] or len(item["body"]) > 100000:
                raise ServiceError(422, "INVALID_SUGGESTION", "Revise o assunto e o corpo da mensagem.")
            item.update(evidence_hash=bundle["evidence_hash"], semantic_hash=bundle["semantic_hash"], source_evidence_hash=full["evidence_hash"], excluded_sent_count=len(repeated) if filtered else 0)
            item.update(version=item["version"] + 1, status="suggested", updated_at=_now(), updated_by=actor)
            for key in ("error", "approval", "attempt_id", "duplicate_of"): item.pop(key, None)
            self._save_version(item, bundle, attachment_files(bundle, description))
            self._event(item, "suggestion_edited", actor)
        return self.get(ident)

    def dismiss(self, ident, payload, actor):
        actor = _actor(actor)
        reason = str(payload.get("reason", payload.get("justification", ""))).strip()
        if not reason or len(reason) > 2000: raise ServiceError(422, "JUSTIFICATION_REQUIRED", "Registre uma justificativa para dispensar a sugestão (até 2.000 caracteres).")
        with self.flow.lock, self._transaction():
            item = self._get(ident)
            if item["status"] not in {"suggested", "failed"}: raise ServiceError(409, "SUGGESTION_NOT_EDITABLE", "Esta sugestão já foi encerrada ou possui tentativa em andamento.")
            if payload.get("version") != item["version"]: raise ServiceError(409, "SUGGESTION_VERSION_MISMATCH", "A sugestão mudou. Reabra antes de dispensar.")
            item.update(status="dismissed", updated_at=_now(), dismissed_by=actor, dismissal_reason=reason)
            self._put(item)
            self._event(item, "suggestion_dismissed", actor, reason=reason)
        return self.get(ident)

    def attachment(self, ident, attachment_id):
        with self.lock:
            self._get(ident)
            row = self.db.execute("SELECT metadata,content FROM mail_suggestion_attachments WHERE id=? AND suggestion_id=?", (attachment_id, ident)).fetchone()
            if not row: raise ServiceError(404, "SUGGESTION_ATTACHMENT_NOT_FOUND", "Anexo não encontrado nesta sugestão.")
            return json.loads(row["metadata"]), bytes(row["content"])

    def _mime(self, item, at, message_id):
        message = EmailMessage(policy=SMTP)
        message["From"], message["To"], message["Subject"] = item["sender"]["email"], item["to"], item["subject"]
        message["Date"], message["Message-ID"] = format_datetime(datetime.fromisoformat(at)), message_id
        message.set_content(item["body"], charset="utf-8")
        for approved in item["attachments"]:
            meta, content = self.attachment(item["id"], approved["id"])
            if meta != approved or len(content) != approved["size"] or hashlib.sha256(content).hexdigest() != approved["sha256"]:
                raise ServiceError(409, "SUGGESTION_ATTACHMENT_CHANGED", "Um anexo diverge da versão revisada; envio bloqueado.")
            main, sub = meta["content_type"].split("/", 1)
            message.add_attachment(content, maintype=main, subtype=sub, filename=meta["name"])
        return message.as_bytes()

    def approve_send(self, ident, payload, actor, context):
        actor, identity = _actor(actor), _identity(context)
        if not identity or not all(identity.values()) or not _email(identity["email"]): raise ServiceError(401, "MAIL_AUTH_REQUIRED", "Conecte uma conta Gmail e autorize esta versão para enviar.")
        if not isinstance(payload, dict) or payload.get("permission") is not True: raise ServiceError(422, "SUGGESTION_PERMISSION_REQUIRED", "É necessária a permissão explícita para enviar a versão exibida.")
        # A caller may not smuggle unseen edits into the confirmation request.
        if set(payload) - {"version", "content_hash", "permission"}: raise ServiceError(422, "SUGGESTION_SAVE_BEFORE_APPROVAL", "Salve as alterações e revise a versão antes de autorizar o envio.")
        # Use the same lock order as prepare/edit. Preserve the run's decisions
        # from final validation until provider dispatch completes.
        with self.flow.lock:
            with self._transaction():
                item = self._get(ident)
                if item["status"] != "suggested": raise ServiceError(409, "SUGGESTION_SEND_LOCKED", "Esta versão já foi tentada ou está encerrada; consulte o histórico.")
                if payload.get("version") != item["version"] or payload.get("content_hash") != item["content_hash"]:
                    raise ServiceError(409, "SUGGESTION_APPROVAL_MISMATCH", "A permissão não corresponde à versão exibida. Reabra a revisão.")
                if _content_hash(item) != item["content_hash"]: raise ServiceError(409, "SUGGESTION_CONTENT_CHANGED", "O conteúdo salvo mudou; envio bloqueado.")
                if item.get("sender") != identity: raise ServiceError(409, "SUGGESTION_SENDER_CHANGED", "Salve e revise esta conta remetente antes de autorizar o envio.")
                groups = self._groups(item["run_id"])[1]
                review = self._decorate(item, groups)
                if review["blockers"]: raise ServiceError(409, "SUGGESTION_REVIEW_REQUIRED", "Resolva os bloqueios e revise a sugestão antes de autorizar.", review["blockers"])
                at, attempt_id = _now(), "suggestion-send-" + uuid.uuid4().hex
                message_id = f"<{attempt_id}@tarvo.local>"
                raw = self._mime(item, at, message_id)
                approval = {"permission": True, "at": at, "declared_actor": actor, "google_account": identity, "version": item["version"], "content_hash": item["content_hash"], "evidence_hash": item["evidence_hash"]}
                mode = getattr(self.auth, "provider_mode", "unknown")
                attempt = {"id": attempt_id, "suggestion_id": ident, "run_id": item["run_id"], "version": item["version"], "status": "sending", "started_at": at, "approval": approval, "approved_content": copy.deepcopy(item), "provider_mode": mode, "mime_sha256": hashlib.sha256(raw).hexdigest()}
                key = _delivery_key(item)
                existing = self.db.execute("SELECT * FROM mail_suggestion_claims WHERE delivery_key=?", (key,)).fetchone()
                if existing and existing["status"] != "failed": raise ServiceError(409, "SUGGESTION_ALREADY_SENT", "Estas evidências já possuem uma tentativa de envio; não serão repetidas.")
                item_keys = {_item_delivery_key(entry["semantic_hash"], identity, item["to"]) for entry in item["items"]}
                for item_key in item_keys:
                    existing_item = self.db.execute("SELECT * FROM mail_suggestion_item_claims WHERE delivery_key=?", (item_key,)).fetchone()
                    if existing_item and existing_item["status"] != "failed":
                        raise ServiceError(409, "SUGGESTION_ALREADY_SENT", "Uma ocorrência desta versão já possui envio confirmado ou incerto; atualize a sugestão e revise apenas as novas evidências.")
                try:
                    self.db.execute("INSERT INTO mail_suggestion_attempts VALUES(?,?,?,?,?,?)", (attempt_id, ident, item["version"], "sending", canonical(attempt), raw))
                    self.db.execute("INSERT INTO mail_suggestion_claims VALUES(?,?,?,?) ON CONFLICT(delivery_key) DO UPDATE SET suggestion_id=excluded.suggestion_id,attempt_id=excluded.attempt_id,status=excluded.status", (key, ident, attempt_id, "sending"))
                    for item_key in item_keys:
                        self.db.execute("INSERT INTO mail_suggestion_item_claims VALUES(?,?,?,?) ON CONFLICT(delivery_key) DO UPDATE SET suggestion_id=excluded.suggestion_id,attempt_id=excluded.attempt_id,status=excluded.status", (item_key, ident, attempt_id, "sending"))
                except sqlite3.IntegrityError:
                    raise ServiceError(409, "SUGGESTION_SEND_LOCKED", "Esta versão já possui uma tentativa registrada.") from None
                item.update(status="sending", updated_at=at, approval=approval, attempt_id=attempt_id, provider_mode=mode, message_id=message_id)
                self._put(item)
                self._event(item, "send_approved", actor, approval=approval, mime_sha256=attempt["mime_sha256"])
            dispatched = False
            try:
                # Recheck after the durable approval; provider receives these exact bytes.
                current = self._groups(item["run_id"])[1].get(item["group_key"])
                if not current or current["evidence_hash"] != item.get("source_evidence_hash", item["evidence_hash"]) or self._scoped_bundle(current, item)["evidence_hash"] != item["evidence_hash"]:
                    raise ServiceError(409, "SUGGESTION_EVIDENCE_CHANGED", "As evidências mudaram antes do envio; revise uma nova versão.")
                dispatched = True
                provider = accepted_result(self.auth.send_message(context, raw))
                status, error = "sent", None
            except Exception as exc:
                status = "failed" if not dispatched or getattr(exc, "outcome", None) == "known_failure" else "uncertain"
                provider = {}
                error = {"code": str(getattr(exc, "code", "SEND_UNCERTAIN" if status == "uncertain" else "SEND_FAILED")), "message": str(getattr(exc, "message", "Não foi possível confirmar o resultado. Confira a pasta Enviados; não haverá repetição automática." if status == "uncertain" else "O envio não foi realizado. Salve e revise uma nova versão antes de autorizar outra tentativa."))}
            with self._transaction():
                item = self._get(ident)
                item.update(status=status, updated_at=_now(), **provider)
                attempt.update(status=status, finished_at=_now(), **provider)
                if error: item["error"] = error; attempt["error"] = error
                if status == "sent":
                    item["sent_at"] = _now()
                    item["delivery_note"] = "Aceito pelo provedor de teste; nenhum e-mail real foi enviado." if mode == "injected_test" else "Aceito pelo provedor; entrega e leitura não foram confirmadas."
                self._put(item)
                self.db.execute("UPDATE mail_suggestion_attempts SET status=?,data=? WHERE id=?", (status, canonical(attempt), attempt_id))
                self.db.execute("UPDATE mail_suggestion_claims SET status=? WHERE delivery_key=? AND attempt_id=?", (status, key, attempt_id))
                self.db.execute("UPDATE mail_suggestion_item_claims SET status=? WHERE attempt_id=?", (status, attempt_id))
                self._event(item, "send_" + status, actor, **provider)
        return self.get(ident)

    def close(self):
        with self.lock:
            if not self._closed:
                self._closed = True
                self.db.close()
