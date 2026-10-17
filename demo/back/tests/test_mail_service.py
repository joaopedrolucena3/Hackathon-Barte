"""External email uses a fake provider only; no Google request is made here."""
import copy
from email import policy
from email.parser import BytesParser
import hashlib
import json
from pathlib import Path
import tempfile
import threading
import unittest

from src.store import Store
from src.mail.service import MailService
from src.mail.evidence import build_evidence, canonical
from src.pipeline.service import ServiceError


ROOT = Path(__file__).resolve().parents[1]
ACTOR = "Analista declarado"
ACCOUNT = {"email": "tarvo.demo@example.com", "sub": "google-account-1", "connection_id": "connection-1"}


class KnownFailure(Exception):
    outcome, code, message = "known_failure", "GMAIL_REJECTED", "O Gmail recusou a mensagem antes de aceitar o envio."


class MailServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tarvo-mail-tests-")
        self.base = Path(self.temp.name)
        self.store = Store(self.base / "closing.sqlite3", ROOT / "data" / "case")
        self.path = self.base / "mail.sqlite3"
        self.mail = MailService(self.path, self.store)
        for party in ("orbe", "ponte"):
            self.mail.save_contact({"counterparty": party, "name": "Contato de teste", "email": party + ".test@example.com", "enabled": True}, ACTOR)
        source = self.store.get("source_data")
        self.checkout_refs = {r["source_ref"] for r in source["checkout"]}
        self.remittance_refs = {r["source_ref"] for r in source["remittances"]}
        issues = self.store.get("result")["pendencias"]
        self.orbe = next(p for p in issues if p["tipo"] == "DIVERGENCIA_TAXA" and p["ref_origem"] in self.checkout_refs)
        self.ponte = next(p for p in issues if p["tipo"] == "DIVERGENCIA_TAXA" and p["ref_origem"] in self.remittance_refs)

    def tearDown(self):
        self.mail.close()
        self.store.close_db()
        self.temp.cleanup()

    def draft(self, issue=None, sender=ACCOUNT):
        return self.mail.create_draft((issue or self.orbe)["id_saida"], ACTOR, sender)

    def approval(self, draft, callback=None, identity=ACCOUNT):
        return self.mail.approve_send(draft["id"], {"version": draft["version"], "content_hash": draft["content_hash"]}, ACTOR, identity, callback or (lambda raw: {"id": "gmail-1", "threadId": "thread-1"}))

    def assert_error(self, code, call):
        with self.assertRaises(ServiceError) as raised: call()
        self.assertEqual(raised.exception.code, code)

    def test_structured_routing_and_relevant_attachments(self):
        for issue, party, collection in ((self.orbe, "orbe", "checkout"), (self.ponte, "ponte", "remittances")):
            draft = self.draft(issue)
            self.assertEqual(draft["counterparty"], party)
            self.assertEqual(draft["to"], party + ".test@example.com")
            self.assertFalse(draft["blockers"])
            evidence = build_evidence(self.store, issue["id_saida"])
            self.assertEqual({r["dataset"] for r in evidence["rows"]}, {collection})
            self.assertLess(len(evidence["rows"]), 10)
            self.assertEqual({a["name"] for a in draft["attachments"]}, {"evidencias.html", "operacoes_relacionadas.csv"})
            for item in draft["attachments"]:
                metadata, content = self.mail.attachment(draft["id"], item["id"])
                self.assertEqual(hashlib.sha256(content).hexdigest(), metadata["sha256"])
                self.assertIn(issue["ref_origem"].encode(), content)
            self.assertTrue(evidence["contracts"])
            self.assertTrue(any("formula" in row for row in evidence["calculation"]))
            self.assert_error("COUNTERPARTY_MISMATCH", lambda: self.mail.save_draft(draft["id"], {"version": 1, "counterparty": "ponte" if party == "orbe" else "orbe", "counterparty_reason": "Tentativa incompatível"}, ACTOR, ACCOUNT))

    def test_missing_contact_and_disconnected_account_block(self):
        self.mail.save_contact({"counterparty": "orbe", "email": "orbe.test@example.com", "enabled": False}, ACTOR)
        draft = self.draft(sender=None)
        codes = {b["code"] for b in draft["blockers"]}
        self.assertTrue({"CONTACT_MISSING", "GMAIL_DISCONNECTED", "RECIPIENT_REQUIRED"} <= codes)
        self.assert_error("MAIL_REVIEW_REQUIRED", lambda: self.approval(draft))

    def test_one_draft_per_issue_and_contact_kind_preserved(self):
        first = self.draft()
        self.assertEqual(self.draft()["id"], first["id"])
        self.assertEqual(len(self.mail.list_drafts(self.orbe["id_saida"])), 1)
        with self.store.lock, self.store.db:
            self.store.db.execute("INSERT INTO contacts VALUES (?,?)", ("legacy", canonical({"id": "legacy", "kind": "internal", "email": "internal@example.com"})))
        self.assert_error("CONTACT_KIND_CONFLICT", lambda: self.mail.save_contact({"id": "legacy", "counterparty": "orbe", "email": "test@example.com"}, ACTOR))
        self.assertEqual(next(c for c in self.store.records("contacts") if c["id"] == "legacy")["kind"], "internal")

    def test_edit_invalidates_old_approval_and_keeps_prior_attachments(self):
        first = self.draft()
        saved = self.mail.save_draft(first["id"], {"version": first["version"], "subject": "Assunto revisado", "body": "Texto confirmado pelo analista."}, ACTOR, ACCOUNT)
        self.assertEqual(saved["version"], 2)
        self.assertNotEqual(first["content_hash"], saved["content_hash"])
        self.assert_error("MAIL_APPROVAL_MISMATCH", lambda: self.approval(first))
        for item in first["attachments"]: self.assertEqual(self.mail.attachment(first["id"], item["id"])[0]["sha256"], item["sha256"])
        self.assertEqual(self.approval(saved)["status"], "sent")

    def test_relevant_source_or_rate_change_stales_but_unrelated_change_does_not(self):
        draft = self.draft()
        data = self.store.get("source_data")
        unrelated = next(r for r in data["remittances"])
        unrelated["spread_brl"] = "123.45"
        with self.store.db: self.store.put("source_data", data)
        self.assertFalse(self.mail.get_draft(draft["id"], ACCOUNT)["stale"])
        related = next(r for r in data["checkout"] if r["source_ref"] == self.orbe["ref_origem"])
        related["gross"] = "999.99"
        with self.store.db: self.store.put("source_data", data)
        self.assertTrue(self.mail.get_draft(draft["id"], ACCOUNT)["stale"])
        self.assert_error("MAIL_REVIEW_REQUIRED", lambda: self.approval(draft))
        refreshed = self.mail.save_draft(draft["id"], {"version": 1, "refresh_evidence": True}, ACTOR, ACCOUNT)
        self.assertFalse(refreshed["stale"])
        self.assertNotEqual(refreshed["evidence_hash"], draft["evidence_hash"])
        evidence = build_evidence(self.store, self.orbe["id_saida"])
        rate_id = evidence["contracts"][0]["id"]
        rate = next(r for r in self.store.records("rates") if r["id"] == rate_id)
        rate["rate_pct"] = "0.77"
        with self.store.db: self.store._store_rate(rate)
        self.assertTrue(self.mail.get_draft(draft["id"], ACCOUNT)["stale"])

    def test_duplicate_and_aggregate_include_all_evidence_rows(self):
        issues = self.store.get("result")["pendencias"]
        duplicate = next(p for p in issues if p["tipo"] == "DUPLICIDADE")
        evidence = build_evidence(self.store, duplicate["id_saida"])
        self.assertEqual(len(evidence["rows"]), 2)
        self.assertEqual(len({r["physical_row"] for r in evidence["rows"]}), 2)
        aggregate = next(p for p in issues if p["tipo"] == "CONFERIR_REPASSE_PONTE")
        evidence = build_evidence(self.store, aggregate["id_saida"])
        self.assertEqual(len({r["id"] for r in evidence["rows"]}), 228)
        self.assertFalse(evidence["blockers"])

    def test_ambiguous_bank_requires_explicit_review_and_mixed_origin_cannot_send(self):
        bank = next(p for p in self.store.get("result")["pendencias"] if p["tipo"] == "CREDITO_NAO_IDENTIFICADO")
        draft = self.draft(bank)
        self.assertIn("COUNTERPARTY_AMBIGUOUS", {b["code"] for b in draft["blockers"]})
        revised = self.mail.save_draft(draft["id"], {"version": 1, "counterparty": "orbe", "counterparty_reason": "Vínculo conferido em documento pelo analista"}, ACTOR, ACCOUNT)
        self.assertEqual(revised["counterparty"], "orbe")
        self.assertFalse(revised["blockers"])
        result = self.store.get("result")
        issue = next(p for p in result["pendencias"] if p["id_saida"] == self.orbe["id_saida"])
        issue["evidence"] += self.ponte["evidence"]
        with self.store.db: self.store.put("result", result)
        mixed = self.draft()
        self.assertIn("MIXED_COUNTERPARTIES", {b["code"] for b in mixed["blockers"]})
        self.assert_error("MAIL_REVIEW_REQUIRED", lambda: self.approval(mixed))

    def test_missing_auth_and_changed_sender_never_call_provider(self):
        draft = self.draft()
        calls = []
        self.assert_error("MAIL_AUTH_REQUIRED", lambda: self.approval(draft, calls.append, None))
        other = {**ACCOUNT, "connection_id": "reconnected"}
        self.assert_error("MAIL_REVIEW_REQUIRED", lambda: self.approval(draft, calls.append, other))
        self.assertEqual(calls, [])
        revised = self.mail.save_draft(draft["id"], {"version": 1}, ACTOR, other)
        self.assertNotEqual(revised["content_hash"], draft["content_hash"])
        self.assertEqual(self.approval(revised, identity=other)["status"], "sent")

    def test_double_click_cross_instance_is_atomic_and_cannot_resend_sent(self):
        draft = self.draft()
        another = MailService(self.path, self.store)
        entered, finish, result = threading.Event(), threading.Event(), []
        def send(raw):
            self.assertEqual(self.mail._get(draft["id"])["status"], "sending")
            entered.set(); finish.wait(5)
            return {"id": "one-only"}
        worker = threading.Thread(target=lambda: result.append(self.approval(draft, send)))
        worker.start()
        self.assertTrue(entered.wait(5))
        try:
            self.assert_error("MAIL_SEND_LOCKED", lambda: another.approve_send(draft["id"], {"version": draft["version"], "content_hash": draft["content_hash"]}, ACTOR, ACCOUNT, lambda raw: self.fail("Duplicate provider invocation")))
        finally:
            finish.set(); worker.join(5); another.close()
        self.assertEqual(result[0]["status"], "sent")
        self.assert_error("MAIL_SEND_LOCKED", lambda: self.approval(draft))
        self.assert_error("MAIL_NOT_EDITABLE", lambda: self.mail.save_draft(draft["id"], {"version": 1}, ACTOR, ACCOUNT))

    def test_known_failure_requires_new_saved_version_and_fresh_approval(self):
        draft = self.draft()
        def fail(raw): raise KnownFailure()
        failed = self.approval(draft, fail)
        self.assertEqual(failed["status"], "failed")
        self.assert_error("MAIL_SEND_LOCKED", lambda: self.approval(failed))
        revised = self.mail.save_draft(draft["id"], {"version": 1}, ACTOR, ACCOUNT)
        self.assertEqual(revised["version"], 2)
        self.assertEqual(self.approval(revised)["status"], "sent")
        self.assertEqual(self.mail.db.execute("SELECT count(*) FROM mail_attempts").fetchone()[0], 2)

    def test_timeout_and_interruption_are_uncertain_without_retry(self):
        draft = self.draft()
        def timeout(raw): raise TimeoutError("secret provider debug data")
        uncertain = self.approval(draft, timeout)
        self.assertEqual(uncertain["status"], "uncertain")
        self.assertNotIn("secret", json.dumps(uncertain))
        self.assert_error("MAIL_SEND_LOCKED", lambda: self.approval(uncertain))
        self.assert_error("MAIL_NOT_EDITABLE", lambda: self.mail.save_draft(draft["id"], {"version": 1}, ACTOR, ACCOUNT))
        second = self.draft(self.ponte)
        class ProcessInterrupted(BaseException): pass
        def interrupt(raw): raise ProcessInterrupted()
        with self.assertRaises(ProcessInterrupted): self.approval(second, interrupt)
        self.assertEqual(self.mail._get(second["id"])["status"], "sending")
        self.mail.close(); self.mail = MailService(self.path, self.store)
        self.assertEqual(self.mail.get_draft(second["id"], ACCOUNT)["status"], "uncertain")

    def test_exact_mime_history_identity_and_financial_state_preserved(self):
        draft = self.draft()
        before = {key: self.store.get(key) for key in ("result", "source_data", "closing")}
        raw_messages = []
        sent = self.approval(draft, lambda raw: raw_messages.append(raw) or {"id": "gmail-accepted"}, {**ACCOUNT, "session_id": "NEVER-PERSIST-THIS"})
        self.assertEqual(sent["status"], "sent")
        parsed = BytesParser(policy=policy.default).parsebytes(raw_messages[0])
        self.assertEqual(parsed["From"], ACCOUNT["email"])
        self.assertEqual(parsed["To"], draft["to"])
        self.assertEqual(parsed["Subject"], draft["subject"])
        self.assertEqual(parsed.get_body(preferencelist=("plain",)).get_content().replace("\r\n", "\n").strip(), draft["body"].strip())
        self.assertEqual({p.get_filename(): hashlib.sha256(p.get_payload(decode=True)).hexdigest() for p in parsed.iter_attachments()}, {a["name"]: a["sha256"] for a in draft["attachments"]})
        attempt = self.mail.db.execute("SELECT data,mime FROM mail_attempts").fetchone()
        self.assertEqual(bytes(attempt["mime"]), raw_messages[0])
        self.assertNotIn("NEVER-PERSIST-THIS", attempt["data"])
        events = self.mail.history(draft["issue_id"])
        approval = next(e for e in events if e["type"] == "send_approved")
        self.assertEqual(approval["declared_actor"], ACTOR)
        self.assertEqual(approval["google_account"], ACCOUNT)
        self.assertTrue(any("leitura não foram confirmadas" in e.get("delivery_note", "") for e in events))
        self.assertEqual(before, {key: self.store.get(key) for key in before})

    def test_invalid_headers_and_foreign_attachments_are_rejected(self):
        draft, other = self.draft(), self.draft(self.ponte)
        self.assert_error("INVALID_DRAFT", lambda: self.mail.save_draft(draft["id"], {"version": 1, "subject": "x\r\nBcc: leak@example.com"}, ACTOR, ACCOUNT))
        self.assert_error("INVALID_RECIPIENT", lambda: self.mail.save_draft(draft["id"], {"version": 1, "to": "one@example.com,two@example.com"}, ACTOR, ACCOUNT))
        self.assert_error("MAIL_ATTACHMENT_NOT_FOUND", lambda: self.mail.attachment(draft["id"], other["attachments"][0]["id"]))

    def test_attachment_content_and_metadata_cannot_change_approved_version(self):
        for tamper in ("content", "name"):
            with self.subTest(tamper=tamper):
                issue = self.orbe if tamper == "content" else self.ponte
                draft = self.draft(issue)
                item = draft["attachments"][0]
                metadata, data = self.mail.attachment(draft["id"], item["id"])
                if tamper == "content":
                    data = b"altered attachment"
                    metadata.update(sha256=hashlib.sha256(data).hexdigest(), size=len(data))
                else: metadata["name"] = "changed-name.html"
                self.mail.db.execute("UPDATE mail_attachments SET metadata=?,content=? WHERE id=?", (canonical(metadata), data, item["id"]))
                self.assert_error("MAIL_ATTACHMENT_CHANGED", lambda: self.approval(draft, lambda raw: self.fail("Altered attachment was sent")))
                self.assertEqual(self.mail._get(draft["id"])["status"], "draft")

    def test_financial_mutation_waits_until_provider_returns(self):
        draft = self.draft()
        attempted, mutated, provider_done = threading.Event(), threading.Event(), threading.Event()
        threads, failures = [], []
        def mutate():
            attempted.set()
            with self.store.lock, self.store.db:
                if not provider_done.is_set(): failures.append("financial mutation raced with dispatch")
                data = self.store.get("source_data")
                next(r for r in data["checkout"] if r["source_ref"] == self.orbe["ref_origem"])["gross"] = "456.78"
                self.store.put("source_data", data)
            mutated.set()
        def provider(raw):
            worker = threading.Thread(target=mutate); threads.append(worker); worker.start()
            self.assertTrue(attempted.wait(2))
            self.assertFalse(mutated.wait(.05))
            provider_done.set()
            return {"id": "sent-before-data-change"}
        self.assertEqual(self.approval(draft, provider)["status"], "sent")
        for worker in threads: worker.join(2)
        self.assertTrue(mutated.is_set())
        self.assertFalse(failures)

    def test_last_evidence_check_aborts_reentrant_change_before_dispatch(self):
        draft = self.draft()
        original_audit = self.mail._audit
        def audit(actor, action, detail):
            original_audit(actor, action, detail)
            if action == "send_approved":
                with self.store.lock, self.store.db:
                    data = self.store.get("source_data")
                    next(r for r in data["checkout"] if r["source_ref"] == self.orbe["ref_origem"])["gross"] = "456.78"
                    self.store.put("source_data", data)
        self.mail._audit = audit
        result = self.approval(draft, lambda raw: self.fail("Stale evidence reached provider"))
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error"]["code"], "MAIL_EVIDENCE_CHANGED")


if __name__ == "__main__": unittest.main()
