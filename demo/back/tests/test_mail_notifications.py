"""No-network notification delivery, persistence, and workflow-hook contracts."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from email import policy
from email.parser import BytesParser
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from src.mail.auth import AuthError, KnownSendFailure, SendUncertain
from src.mail.notifications import NotificationService
from src.pipeline.recommendations import POLICY_VERSION
from src.pipeline.service import PipelineService, ServiceError, _hash


class FakeNotificationAuth:
    provider_mode = "injected_test"

    def __init__(self):
        self.context = {"email": "financeirotarvo@gmail.com", "sub": "owner", "connection_id": "connection-1"}
        self.connected = True
        self.sent = []
        self.result = {"id": "fake-provider-id"}

    def background_context(self):
        if not self.connected:
            raise AuthError(401, "MAIL_CONNECTION_REQUIRED", "Conecte a conta para enviar.")
        return {**self.context, "background_token": "never-persist-this-capability"}

    def send_message(self, context, raw):
        assert context["connection_id"] == self.context["connection_id"]
        self.sent.append(raw)
        if isinstance(self.result, Exception):
            raise self.result
        return deepcopy(self.result)


def run(ident="run-1", status="done", draft=True):
    return {"id": ident, "status": status, "draft": draft, "competencia": "2026-09",
            "steps": [{"status": "done"}, {"status": "done_with_exceptions"}, {"status": "skipped"}],
            "exceptions_total": 3, "exceptions_open": 2, "blocking_open": 1,
            "datasets": {"private": "financial-data-must-not-be-sent"},
            "error": {"message": "sensitive-diagnostic-must-not-be-sent"}}


class NotificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tarvo-notification-tests-")
        self.path = Path(self.temp.name) / "notifications.sqlite3"
        self.auth = FakeNotificationAuth()
        self.service = NotificationService(self.path, self.auth)

    def tearDown(self):
        self.service.close()
        self.temp.cleanup()

    def enable(self, **fields):
        return self.service.configure({"enabled": True, "recipient": "recipient@example.com", **fields}, "Analista", self.auth.context)

    def test_disabled_by_default_and_enabling_does_not_backfill(self):
        self.assertEqual(self.service.settings()["recipient"], "financeirotarvo@gmail.com")
        self.assertFalse(self.service.settings()["enabled"])
        self.assertIsNone(self.service.on_run(run()))
        self.assertEqual(self.service.deliveries(), [])
        self.enable()
        self.assertEqual(self.auth.sent, [])
        self.assertEqual(self.service.deliveries(), [])
        self.assertIsNone(self.service.on_run(run(status="running")))

    def test_settings_require_an_account_and_single_explicit_recipient(self):
        for recipient in ("", "first@example.com,second@example.com", "A <a@example.com>", "a@example.com\r\nBcc:b@example.com"):
            with self.assertRaises(ServiceError):
                self.enable(recipient=recipient)
        with self.assertRaises(ServiceError):
            self.service.configure({"enabled": True, "recipient": "a@example.com"}, "Analista", None)
        with self.assertRaises(ServiceError):
            self.service.configure({"enabled": "true"}, "Analista", self.auth.context)
        self.enable()
        self.auth.connected = False
        self.service.configure({"enabled": False}, "Analista", None)
        self.assertFalse(self.service.settings()["enabled"])

    def test_each_run_state_claimed_once_concurrently_and_survives_restart(self):
        self.enable()
        # Two service instances use separate SQLite connections, as separate workers would.
        second = NotificationService(self.path, self.auth)
        try:
            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda index: (self.service if index % 2 else second).on_run(run()), range(12)))
            self.assertEqual(len({result["id"] for result in results}), 1)
            self.assertEqual(len(self.auth.sent), 1)
        finally:
            second.close()
        self.service.close()
        self.service = NotificationService(self.path, self.auth)
        self.assertEqual(self.service.on_run(run())["status"], "accepted")
        self.assertEqual(len(self.auth.sent), 1)
        self.service.on_run(run(status="awaiting_approval", draft=False))
        self.assertEqual(len(self.auth.sent), 2)

    def test_notice_summarizes_counts_and_distinguishes_test_from_close(self):
        self.enable()
        delivery = self.service.on_run(run())
        message = BytesParser(policy=policy.default).parsebytes(self.auth.sent[-1])
        self.assertIn("Teste concluído", message["Subject"])
        self.assertEqual(message["To"], "recipient@example.com")
        self.assertEqual(message["From"], "financeirotarvo@gmail.com")
        self.assertEqual(message["Message-ID"], delivery["message_id"])
        self.assertFalse(list(message.iter_attachments()))
        body = message.get_content()
        for expected in ("Run: run-1", "Competência: 2026-09", "Etapas concluídas: 2 de 3", "Pendências abertas: 2", "Bloqueios abertos: 1"):
            self.assertIn(expected, body)
        self.assertNotIn("financial-data", body)
        self.assertNotIn("sensitive-diagnostic", body)
        self.service.on_run(run("run-2", "awaiting_approval", False))
        message = BytesParser(policy=policy.default).parsebytes(self.auth.sent[-1])
        self.assertIn("Fechamento aguardando revisão", message["Subject"])
        self.assertIn("revisão humana ainda é necessária", message.get_content())
        self.assertNotIn("never-persist-this-capability", self.path.read_bytes().decode("utf-8", errors="ignore"))
        self.assertNotIn("background_token", json.dumps(self.service.deliveries()))

    def test_manual_test_is_explicit_and_does_not_enable_automation(self):
        delivery = self.service.test(self.auth.context, "Analista")
        self.assertEqual(delivery["status"], "accepted")
        self.assertEqual(delivery["event"], "notification_test")
        self.assertIsNone(delivery["run_id"])
        self.assertEqual(delivery["recipient"], "financeirotarvo@gmail.com")
        self.assertIn("nenhum e-mail real", delivery["delivery_note"])
        self.assertFalse(self.service.settings()["enabled"])
        self.assertIsNone(self.service.on_run(run()))
        self.assertEqual(len(self.auth.sent), 1)

    def test_smtp_acceptance_does_not_claim_inbox_delivery(self):
        self.auth.provider_mode = "gmail_smtp"
        self.auth.result = {"accepted": True, "provider": "gmail_smtp", "message_id": "<mime-id>", "smtp_response_code": 250}
        self.enable()
        delivery = self.service.on_run(run())
        self.assertEqual(delivery["status"], "accepted")
        self.assertEqual(delivery["smtp_response_code"], 250)
        self.assertNotIn("provider_message_id", delivery)
        self.assertIn("entrega e leitura não foram confirmadas", delivery["delivery_note"])

    def test_known_failure_uncertain_and_malformed_provider_results_do_not_retry(self):
        self.enable()
        for index, (outcome, expected) in enumerate((
                (KnownSendFailure("REFUSED", "Recusado"), "failed"),
                (SendUncertain("TIMEOUT", "Incerto"), "uncertain"),
                (RuntimeError("secret-network-detail"), "uncertain"),
                ({"accepted": True}, "uncertain"))):
            self.auth.result = outcome
            value = run(f"run-{index}")
            result = self.service.on_run(value)
            self.assertEqual(result["status"], expected)
            self.assertNotIn("secret-network-detail", json.dumps(result))
            self.auth.result = {"id": "would-be-duplicate"}
            self.assertEqual(self.service.on_run(value)["status"], expected)
        self.assertEqual(len(self.auth.sent), 4)

    def test_disconnection_and_replacement_account_require_reenable(self):
        self.enable()
        self.auth.connected = False
        self.assertEqual(self.service.on_run(run())["status"], "unavailable")
        self.assertFalse(self.auth.sent)
        self.auth.connected = True
        self.auth.context["connection_id"] = "replacement-connection"
        changed = self.service.on_run(run("run-2"))
        self.assertEqual(changed["status"], "unavailable")
        self.assertEqual(changed["error"]["code"], "NOTIFICATION_ACCOUNT_CHANGED")
        self.assertFalse(self.auth.sent)
        self.enable()
        self.assertEqual(self.service.on_run(run("run-3"))["status"], "accepted")
        self.assertEqual(len(self.auth.sent), 1)

    def test_restart_marks_inflight_uncertain_without_resending(self):
        self.enable()
        with self.service._transaction():
            data, raw = self.service._claim(self.service._settings(), run(), "Sistema", "done")
        self.assertTrue(raw)
        self.assertEqual(data["status"], "sending")
        self.service.close()
        self.service = NotificationService(self.path, self.auth)
        recovered = self.service.deliveries()[0]
        self.assertEqual(recovered["status"], "uncertain")
        self.assertEqual(recovered["error"]["code"], "NOTIFICATION_INTERRUPTED")
        self.service.on_run(run())
        self.assertFalse(self.auth.sent)


class PipelineNotificationHookTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tarvo-notification-hook-")
        base = Path(self.temp.name)
        self.service = PipelineService(base / "workflow.sqlite3", base, base / "runs")
        self.service._assert_snapshot = lambda value: None
        self.service._context = lambda value: {}

    def tearDown(self):
        self.service.close()
        self.temp.cleanup()

    def seed(self, draft=True, approval=False):
        steps = [{"id": "approval", "type": "aprovacao", "params": {}, "status": "pending"}] if approval else []
        value = {"id": "run-hook", "competencia": "2026-09", "status": "queued", "draft": draft,
                 "steps": deepcopy(steps), "datasets": {}, "exports": [], "started_at": None,
                 "directory": self.temp.name, "snapshot": {"definition": {"steps": steps}, "step_versions": {},
                     "assumptions": [], "assumptions_hash": _hash([]),
                     "recommendation_policy_version": POLICY_VERSION}}
        with self.service.lock, self.service.db:
            self.service._save_run(value)

    def test_callback_gets_committed_result_and_does_not_hold_pipeline_lock(self):
        self.seed()
        seen = []
        def callback(value):
            acquired = threading.Event()
            def reader():
                with self.service.lock:
                    seen.append(self.service.get_run(value["id"])["status"])
                    acquired.set()
            reader_thread = threading.Thread(target=reader)
            reader_thread.start()
            self.assertTrue(acquired.wait(2), "callback must not hold workflow lock")
            reader_thread.join(2)
            self.assertFalse(self.service.db.in_transaction)
            seen.append(value["status"])
        self.service.on_run = callback
        self.service._execute("run-hook")
        self.assertEqual(seen, ["done", "done"])

    def test_notification_outage_does_not_change_completed_run(self):
        self.seed()
        def outage(value):
            raise RuntimeError("email unavailable")
        self.service.on_run = outage
        self.service._execute("run-hook")
        self.assertEqual(self.service.get_run("run-hook")["status"], "done")

    def test_awaiting_approval_and_failure_are_notified_once(self):
        for fail in (False, True):
            with self.subTest(fail=fail):
                self.seed(draft=False, approval=True)
                seen = []
                self.service.on_run = seen.append
                with patch("src.pipeline.service.execute_step", side_effect=ValueError("step failed") if fail else None, return_value={}):
                    self.service._execute("run-hook")
                self.assertEqual(len(seen), 1)
                self.assertEqual(seen[0]["status"], "failed" if fail else "awaiting_approval")
                self.assertEqual(seen[0]["exceptions_total"], 0)


if __name__ == "__main__":
    unittest.main()
