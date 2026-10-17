"""Durable opt-in execution notices, independent of financial output and approval.

Each run/state is claimed once before contacting the email provider. Outcomes are
kept for review; uncertain sends are never retried automatically. Stored messages
contain summary counts only, without financial attachments or authentication data.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import format_datetime
import json
from pathlib import Path
import re
import sqlite3
import threading
import uuid

from ..pipeline.service import ServiceError
from .auth import AuthError, KnownSendFailure, SendUncertain
from .delivery import accepted_result


DEFAULT_RECIPIENT = "financeirotarvo@gmail.com"
EVENTS = {"awaiting_approval": "aguardando revisão", "done": "concluído", "failed": "falhou"}


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _email(value):
    if not isinstance(value, str):
        return None
    value = value.strip()
    if len(value) > 254 or not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}", value):
        return None
    return value


def _actor(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 120 or any(ord(c) < 32 for c in value):
        raise ServiceError(422, "ACTOR_REQUIRED", "Informe o nome do responsável (até 120 caracteres).")
    return value.strip()


def _account(context):
    # Deliberately discard session IDs and background authorization capabilities.
    if not isinstance(context, dict) or not _email(context.get("email")) or not context.get("connection_id"):
        raise ServiceError(401, "MAIL_CONNECTION_REQUIRED", "Conecte uma conta de e-mail antes de ativar os avisos.")
    return {key: str(context.get(key, "")) for key in ("email", "sub", "connection_id")}


def _count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


class NotificationService:
    def __init__(self, db_path, auth):
        self.auth = auth
        self.lock = threading.RLock()
        self._delivery_lock = threading.RLock()
        self._closed = False
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(db_path), check_same_thread=False, timeout=15, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=15000")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS mail_notification_settings(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS mail_notification_deliveries(
            id TEXT PRIMARY KEY, run_id TEXT, event TEXT NOT NULL, status TEXT NOT NULL,
            data TEXT NOT NULL, mime BLOB NOT NULL, UNIQUE(run_id,event));
        """)
        with self._transaction():
            self.db.execute("INSERT OR IGNORE INTO mail_notification_settings VALUES(1,?)", (_json({
                "enabled": False, "recipient": DEFAULT_RECIPIENT, "connection_id": None,
                "sender": None, "updated_at": None, "updated_by": None}),))
            for row in self.db.execute("SELECT data FROM mail_notification_deliveries WHERE status='sending'").fetchall():
                data = json.loads(row["data"])
                data.update(status="uncertain", finished_at=_now(), error={
                    "code": "NOTIFICATION_INTERRUPTED",
                    "message": "O envio foi interrompido. Confira a caixa de e-mail antes de enviar outro aviso; não haverá repetição automática."})
                self._put(data)

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

    def _settings(self):
        return json.loads(self.db.execute("SELECT data FROM mail_notification_settings WHERE id=1").fetchone()["data"])

    def settings(self):
        with self.lock:
            result = self._settings()
            result.pop("sender", None)
            return result

    def configure(self, payload, actor, context):
        actor = _actor(actor)
        if not isinstance(payload, dict) or not isinstance(payload.get("enabled"), bool):
            raise ServiceError(422, "INVALID_NOTIFICATION_SETTINGS", "Informe se os avisos automáticos devem ficar ativados.")
        with self.lock:
            previous = self._settings()
        recipient = _email(payload.get("recipient", previous["recipient"]))
        if not recipient:
            raise ServiceError(422, "INVALID_RECIPIENT", "Informe um único endereço de e-mail válido para os avisos.")
        sender = previous.get("sender")
        if payload["enabled"]:
            sender = _account(context)
            self._check_connection(sender)
        result = {"enabled": payload["enabled"], "recipient": recipient,
                  "connection_id": sender["connection_id"] if sender else None,
                  "sender": sender, "updated_at": _now(), "updated_by": actor}
        # Enabling only affects future callbacks: no scan or backfill of old runs.
        with self._transaction():
            self.db.execute("UPDATE mail_notification_settings SET data=? WHERE id=1", (_json(result),))
        return self.settings()

    def deliveries(self):
        with self.lock:
            return [json.loads(row["data"]) for row in self.db.execute(
                "SELECT data FROM mail_notification_deliveries ORDER BY rowid DESC LIMIT 100")]

    def _put(self, data):
        self.db.execute("UPDATE mail_notification_deliveries SET status=?,data=? WHERE id=?",
                        (data["status"], _json(data), data["id"]))

    def _check_connection(self, expected):
        context = self.auth.background_context()
        current = _account(context)
        if any(current[key] != expected.get(key) for key in ("email", "sub", "connection_id")):
            raise AuthError(409, "NOTIFICATION_ACCOUNT_CHANGED", "A conta conectada mudou. Ative novamente os avisos para usar essa conta.")
        return context

    def _claim(self, settings, run, actor, event):
        run_id = run.get("id") if run is not None else None
        kind = "Teste" if run is None or run.get("draft") else "Fechamento"
        period = str(run.get("competencia") or run.get("period") or "não informada") if run is not None else None
        counts = None
        if run is None:
            subject = "[Tarvo] Teste de notificação"
            body = "Este é um teste de envio dos avisos da demo Tarvo.\n\nSe você recebeu esta mensagem, a conexão de e-mail está funcionando.\n"
        else:
            steps = run.get("steps", [])
            counts = {"steps_completed": sum(s.get("status") in {"done", "done_with_exceptions"} for s in steps),
                      "steps_total": len(steps), "exceptions_total": _count(run.get("exceptions_total")),
                      "exceptions_open": _count(run.get("exceptions_open")), "blocking_open": _count(run.get("blocking_open"))}
            subject = f"[Tarvo] {kind} {EVENTS[event]} — {period}"
            lines = [f"{kind} do pipeline Tarvo", f"Status: {EVENTS[event]}", f"Run: {run_id}",
                     f"Competência: {period}", f"Etapas concluídas: {counts['steps_completed']} de {counts['steps_total']}"]
            for label, key in (("Pendências totais", "exceptions_total"), ("Pendências abertas", "exceptions_open"), ("Bloqueios abertos", "blocking_open")):
                lines.append(f"{label}: {counts[key] if counts[key] is not None else 'não informado'}")
            if event == "awaiting_approval":
                lines.append("A revisão humana ainda é necessária para concluir o fechamento.")
            if run.get("draft"):
                lines.append("Esta execução foi um teste de pipeline, sem exportação contábil.")
            body = "\n".join(lines) + "\n\nAbra Comunicações > E-mail e selecione esta run para revisar as sugestões de contestação disponíveis.\nCada contestação precisa da sua permissão antes do envio; este aviso não autoriza nenhum envio a parceiros.\n"
        ident = "notice-" + uuid.uuid4().hex
        message_id = f"<{ident}@notifications.tarvo.local>"
        data = {"id": ident, "run_id": run_id, "event": event, "status": "sending", "kind": kind,
                "period": period, "recipient": settings["recipient"], "subject": subject, "counts": counts,
                "created_at": _now(), "finished_at": None, "created_by": actor,
                "connection_id": settings["connection_id"], "sender": settings["sender"],
                "provider_mode": getattr(self.auth, "provider_mode", "unknown"), "message_id": message_id}
        message = EmailMessage(policy=SMTP)
        message["From"] = settings["sender"]["email"]
        message["To"] = settings["recipient"]
        message["Subject"] = subject
        message["Date"] = format_datetime(datetime.now(timezone.utc))
        message["Message-ID"] = message_id
        message.set_content(body)
        raw = message.as_bytes()
        cursor = self.db.execute("INSERT OR IGNORE INTO mail_notification_deliveries VALUES(?,?,?,?,?,?)",
                                 (ident, run_id, event, "sending", _json(data), raw))
        if not cursor.rowcount:
            existing = self.db.execute("SELECT data FROM mail_notification_deliveries WHERE run_id=? AND event=?", (run_id, event)).fetchone()
            return json.loads(existing["data"]), None
        return data, raw

    def _deliver(self, data, raw, context=None):
        if raw is None:
            return data
        try:
            current = self._check_connection(data["sender"])
            if context is None:
                context = current
            else:
                supplied = _account(context)
                if supplied != data["sender"]:
                    raise AuthError(409, "NOTIFICATION_ACCOUNT_CHANGED", "A conta conectada mudou. Conecte novamente antes de enviar.")
        except (AuthError, ServiceError, KnownSendFailure) as exc:
            data.update(status="unavailable", error={"code": exc.code, "message": exc.message})
        except Exception:
            data.update(status="unavailable", error={"code": "NOTIFICATION_CONNECTION_UNAVAILABLE", "message": "Não foi possível obter a conexão de e-mail. Nenhum envio foi realizado."})
        else:
            try:
                result = self.auth.send_message(context, raw)
                try:
                    provider = accepted_result(result)
                except ValueError:
                    raise SendUncertain()
                data["status"] = "accepted"
                data.update({key: value for key, value in provider.items() if value is not None})
                data["delivery_note"] = ("Aceito pelo provedor de teste; nenhum e-mail real foi enviado."
                                         if data["provider_mode"] == "injected_test"
                                         else "Aceito pelo provedor de e-mail; entrega e leitura não foram confirmadas.")
            except KnownSendFailure as exc:
                data.update(status="failed", error={"code": exc.code, "message": exc.message})
            except SendUncertain as exc:
                data.update(status="uncertain", error={"code": exc.code, "message": exc.message})
            except Exception:
                data.update(status="uncertain", error={"code": "NOTIFICATION_RESULT_UNCERTAIN", "message": "Não foi possível confirmar o envio. Confira a caixa de e-mail; não haverá repetição automática."})
        data["finished_at"] = _now()
        with self._transaction():
            self._put(data)
        return data

    def test(self, context, actor):
        actor = _actor(actor)
        sender = _account(context)
        with self._delivery_lock:
            with self._transaction():
                settings = self._settings()
                settings.update(sender=sender, connection_id=sender["connection_id"])
                data, raw = self._claim(settings, None, actor, "notification_test")
            return self._deliver(data, raw, context)

    def on_run(self, run):
        if not isinstance(run, dict) or run.get("status") not in EVENTS or not isinstance(run.get("id"), str) or not run["id"]:
            return None
        with self._delivery_lock:
            if self._closed:
                return None
            with self._transaction():
                settings = self._settings()
                if not settings["enabled"]:
                    return None
                data, raw = self._claim(settings, run, "Sistema", run["status"])
            return self._deliver(data, raw)

    def close(self):
        with self._delivery_lock, self.lock:
            if not self._closed:
                self._closed = True
                self.db.close()
