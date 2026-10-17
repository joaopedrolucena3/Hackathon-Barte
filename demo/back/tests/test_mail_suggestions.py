"""Run snapshots, explicit permission, exact reviewed bytes and durable dedup."""
from copy import deepcopy
from email import policy
from email.parser import BytesParser
import hashlib
import json
from pathlib import Path
import tempfile
import threading
import unittest

from src.mail.auth import KnownSendFailure
from src.mail.evidence import canonical, digest
from src.mail.service import MailService
from src.mail.suggestions import SuggestionService
from src.mail.suggestion_evidence import semantic
from src.pipeline.service import ServiceError
from src.store import Store


ROOT = Path(__file__).resolve().parents[1]
ACCOUNT = {"email": "financeirotarvo@gmail.com", "sub": "verified-account", "connection_id": "connection-1"}
ACTOR = "Analista de teste"


class FakeAuth:
    provider_mode = "injected_test"
    def __init__(self): self.sent, self.result = [], {"id": "test-accepted"}
    def send_message(self, context, raw):
        self.sent.append(raw)
        if isinstance(self.result, BaseException): raise self.result
        return self.result


class SnapshotFlow:
    """Small preserved-output fixture; API tests cover the real pipeline hook."""
    def __init__(self, base, store):
        self.lock, self.runs, self.contexts = threading.RLock(), {}, {}
        source = store.get("source_data")
        result = store.get("result")
        data = {"resultado_snapshot": [result], "raw_orbe": source["checkout"], "raw_remittances": source["remittances"], "raw_bank": source["bank"], "raw_merchants": store.records("merchants"), "raw_rates": store.records("rates")}
        self.path = base / "preserved-result.json"
        self.path.write_text(canonical(data))
        self.fingerprint = hashlib.sha256(self.path.read_bytes()).hexdigest()
        original = base / "preserved-input.csv"
        original.write_text("immutable original\n")
        snapshot = {"sources": [{"snapshot_path": str(original), "sha256": hashlib.sha256(original.read_bytes()).hexdigest()}], "references": {"parameters": store.get("parameters")}, "history": {"checkout": []}}
        snapshot.update(references_hash=digest(snapshot["references"]), history_hash=digest(snapshot["history"]))
        run = {"id": "run-1", "competencia": "2026-09", "status": "awaiting_approval", "draft": True, "snapshot": snapshot}
        exceptions = [{**deepcopy(issue), "id": issue["id_saida"], "status": "open"} for issue in result["pendencias"]]
        self.runs[run["id"]] = run
        self.contexts[run["id"]] = {"datasets": data, "exceptions": exceptions, "references": snapshot["references"], "history_checkout": []}

    def get_run(self, ident): return deepcopy(self.runs[ident])
    def _context(self, run):
        if hashlib.sha256(self.path.read_bytes()).hexdigest() != self.fingerprint: raise ServiceError(409, "DATASET_CHANGED", "A saída imutável foi alterada.")
        return deepcopy(self.contexts[run["id"]])
    def clone(self, ident):
        self.runs[ident] = {**deepcopy(self.runs["run-1"]), "id": ident}
        self.contexts[ident] = deepcopy(self.contexts["run-1"])


class SuggestionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tarvo-suggestion-tests-")
        self.base = Path(self.temp.name)
        self.store = Store(self.base / "closing.sqlite3", ROOT / "data" / "case")
        self.mail = MailService(self.base / "mail.sqlite3", self.store)
        self.flow = SnapshotFlow(self.base, self.store)
        self.auth = FakeAuth()
        self.path = self.base / "suggestions.sqlite3"
        self.service = SuggestionService(self.path, self.flow, self.mail, self.auth)

    def tearDown(self):
        self.service.close(); self.mail.close(); self.store.close_db(); self.temp.cleanup()

    def prepare(self, run_id="run-1"):
        return self.service.prepare(run_id, ACTOR)

    def selected(self, run_id="run-1", kind="DIVERGENCIA_TAXA", party="orbe"):
        return next(item for item in self.prepare(run_id) if item["kind"] == kind and item["counterparty"] == party)

    def review(self, item=None):
        item = item or self.selected()
        return self.service.edit(item["id"], {"version": item["version"]}, ACTOR, ACCOUNT)

    def approve(self, item, **payload):
        return self.service.approve_send(item["id"], {"version": item["version"], "content_hash": item["content_hash"], "permission": True, **payload}, ACTOR, {**ACCOUNT, "session_id": "do-not-persist"})

    def assert_error(self, code, call):
        with self.assertRaises(ServiceError) as raised: call()
        self.assertEqual(raised.exception.code, code)

    def test_preparation_groups_open_evidenced_issues_and_never_sends(self):
        items = self.prepare()
        self.assertGreater(len(items), 3)
        self.assertEqual(len({(i["counterparty"], i["period"], i["kind"]) for i in items}), len(items))
        for item in items:
            self.assertEqual(item["status"], "suggested")
            self.assertEqual(item["recipient_basis"], "demo")
            self.assertEqual(item["to"], ACCOUNT["email"])
            self.assertTrue(item["justification"] and item["recommended_action"] and item["limitations"])
            self.assertEqual(item["item_count"], len(item["items"]))
            self.assertEqual(len(item["attachments"]), 2)
            self.assertTrue(all(i["source_refs"] for i in item["items"]))
            self.assertNotIn("total_brl", item)
            self.assertLess(len(item["body"]), 5000)
            if item["item_count"] > 5: self.assertIn("a lista completa", item["body"])
            if item["kind"] != "DIVERGENCIA_TAXA": self.assertFalse(any("value_brl" in i for i in item["items"]))
        excluded = self.service.run_summary("run-1")["excluded"]
        self.assertTrue(excluded)
        self.assertTrue(all(item["reason"] for item in excluded))
        self.assertEqual({i["id"] for i in self.service.on_run(self.flow.get_run("run-1"))}, {i["id"] for i in items})
        self.assertEqual(self.auth.sent, [])

    def test_immutable_snapshot_ignores_mutable_close_and_missing_snapshot_is_explicit(self):
        item = self.selected()
        with self.store.lock, self.store.db:
            self.store.put("result", {"pendencias": []})
            self.store.put("source_data", {})
        self.store._results = lambda: self.fail("Current results must never be calculated")
        self.assertEqual(self.service.get(item["id"])["evidence_hash"], item["evidence_hash"])
        self.assertFalse(self.service.get(item["id"])["stale"])
        self.flow.clone("historical")
        del self.flow.contexts["historical"]["datasets"]["resultado_snapshot"]
        self.assertEqual(self.prepare("historical"), [])
        self.assertEqual(self.service.run_summary("historical")["unavailable"]["code"], "RUN_EVIDENCE_UNAVAILABLE")
        self.assertEqual(self.auth.sent, [])

    def test_permission_sender_and_exact_version_are_mandatory(self):
        item = self.selected()
        self.assert_error("SUGGESTION_SENDER_CHANGED", lambda: self.approve(item))
        reviewed = self.review(item)
        self.assertFalse(reviewed["blockers"])
        self.assert_error("SUGGESTION_PERMISSION_REQUIRED", lambda: self.approve(reviewed, permission=False))
        self.assert_error("SUGGESTION_PERMISSION_REQUIRED", lambda: self.approve(reviewed, permission="true"))
        self.assert_error("SUGGESTION_APPROVAL_MISMATCH", lambda: self.approve(item))
        self.assert_error("SUGGESTION_SAVE_BEFORE_APPROVAL", lambda: self.approve(reviewed, body="unreviewed edit"))
        changed = self.service.edit(reviewed["id"], {"version": reviewed["version"], "subject": "Assunto revisado"}, ACTOR, ACCOUNT)
        self.assert_error("SUGGESTION_APPROVAL_MISMATCH", lambda: self.approve(reviewed))
        self.assertEqual(self.auth.sent, [])
        self.assertEqual(self.approve(changed)["status"], "sent")

    def test_approved_mime_matches_preview_and_durable_history(self):
        item = self.review()
        sent = self.approve(item)
        self.assertEqual(sent["status"], "sent")
        raw = self.auth.sent[0]
        message = BytesParser(policy=policy.default).parsebytes(raw)
        self.assertEqual(message["From"], ACCOUNT["email"])
        self.assertEqual(message["To"], item["to"])
        self.assertEqual(message["Subject"], item["subject"])
        self.assertEqual(message.get_body(preferencelist=("plain",)).get_content().replace("\r\n", "\n").strip(), item["body"].strip())
        self.assertEqual({part.get_filename(): hashlib.sha256(part.get_payload(decode=True)).hexdigest() for part in message.iter_attachments()}, {a["name"]: a["sha256"] for a in item["attachments"]})
        attempt = self.service.db.execute("SELECT data,mime FROM mail_suggestion_attempts").fetchone()
        self.assertEqual(bytes(attempt["mime"]), raw)
        self.assertNotIn("do-not-persist", attempt["data"])
        self.assertTrue(json.loads(attempt["data"])["approval"]["permission"])
        self.assert_error("SUGGESTION_SEND_LOCKED", lambda: self.approve(item))
        self.assert_error("SUGGESTION_NOT_EDITABLE", lambda: self.service.edit(item["id"], {"version": item["version"]}, ACTOR, ACCOUNT))

    def test_cross_run_dedup_survives_restart_and_new_connection(self):
        item = self.review()
        self.approve(item)
        self.service.close()
        self.service = SuggestionService(self.path, self.flow, self.mail, self.auth)
        self.flow.clone("run-2")
        second = self.selected("run-2")
        second = self.service.edit(second["id"], {"version": second["version"]}, ACTOR, {**ACCOUNT, "connection_id": "reconnected"})
        self.assertEqual(second["duplicate_of"], item["id"])
        self.assertIn("SUGGESTION_ALREADY_SENT", {b["code"] for b in second["blockers"]})
        self.assert_error("SUGGESTION_REVIEW_REQUIRED", lambda: self.service.approve_send(second["id"], {"version": second["version"], "content_hash": second["content_hash"], "permission": True}, ACTOR, {**ACCOUNT, "connection_id": "reconnected"}))
        self.assertEqual(len(self.auth.sent), 1)

    def test_rerun_added_removed_or_changed_item_deduplicates_each_evidence(self):
        first = self.review()
        self.approve(first)
        self.flow.clone("run-plus-one")
        context = self.flow.contexts["run-plus-one"]
        result = context["datasets"]["resultado_snapshot"][0]
        original = next(issue for issue in result["pendencias"] if issue["id_saida"] == first["items"][0]["id"])
        old_id, old_ref, old_divergence = original["id_saida"], original["ref_origem"], original.get("divergence_id")
        extra = deepcopy(original)
        extra.update(id_saida="PEND-new-operation", ref_origem="NEW-OPERATION", divergence_id="DIV-new-operation")
        original_row = next(row for row in context["datasets"]["raw_orbe"] if row["source_ref"] == old_ref)
        new_row = {**deepcopy(original_row), "id": "NEW-OPERATION", "source_ref": "NEW-OPERATION", "physical_row": 99999}
        context["datasets"]["raw_orbe"].append(new_row)
        for link in extra["evidence"]: link.update(ref="NEW-OPERATION", linha=99999)
        result["pendencias"].append(extra)
        context["exceptions"].append({**deepcopy(extra), "id": extra["id_saida"], "status": "open"})
        for key in ("rastro", "details"):
            for row in list(result[key]):
                if row.get("id_saida") in {old_id, old_divergence}:
                    copied = deepcopy(row)
                    copied.update(id_saida=extra["id_saida"] if row["id_saida"] == old_id else extra["divergence_id"], ref_origem="NEW-OPERATION", source_row=99999)
                    result[key].append(copied)
        # A stale form still carries the whole group's body. Saving the selected
        # sender must regenerate a new one-item review rather than restore it.
        added = self.selected("run-plus-one")
        self.assertEqual(added["item_count"], first["item_count"] + 1)
        delta = self.service.edit(added["id"], {"version": added["version"], "subject": added["subject"], "body": added["body"]}, ACTOR, ACCOUNT)
        self.assertEqual(delta["item_count"], 1)
        self.assertEqual(delta["excluded_sent_count"], first["item_count"])
        self.assertEqual(delta["items"][0]["reference"], "NEW-OPERATION")
        self.assertFalse(delta["blockers"])
        self.assertNotIn(old_ref, delta["body"])
        self.assertIn("retiradas", " ".join(delta["limitations"]))
        self.assertEqual(self.approve(delta)["status"], "sent")
        message = BytesParser(policy=policy.default).parsebytes(self.auth.sent[-1])
        csv_part = next(part for part in message.iter_attachments() if part.get_filename().endswith(".csv"))
        self.assertIn(b"NEW-OPERATION", csv_part.get_payload(decode=True))
        self.assertNotIn(old_ref.encode(), csv_part.get_payload(decode=True))

        self.flow.clone("run-minus-one")
        reduced = self.flow.contexts["run-minus-one"]
        reduced["datasets"]["resultado_snapshot"][0]["pendencias"] = [issue for issue in reduced["datasets"]["resultado_snapshot"][0]["pendencias"] if issue["id_saida"] != old_id]
        blocked = self.review(self.selected("run-minus-one"))
        self.assertEqual(blocked["already_sent_count"], blocked["item_count"])
        self.assertIn("SUGGESTION_ALREADY_SENT", {b["code"] for b in blocked["blockers"]})
        self.assert_error("SUGGESTION_REVIEW_REQUIRED", lambda: self.approve(blocked))

        self.flow.clone("run-changed")
        altered = self.flow.contexts["run-changed"]
        next(row for row in altered["datasets"]["raw_orbe"] if row["source_ref"] == old_ref)["gross"] = "9999.99"
        changed = self.review(self.selected("run-changed"))
        self.assertEqual(changed["item_count"], 1)
        self.assertEqual(changed["items"][0]["reference"], old_ref)
        self.assertEqual(changed["excluded_sent_count"], first["item_count"] - 1)
        self.assertFalse(changed["blockers"])
        self.assertEqual(len(self.auth.sent), 2)

    def test_semantic_hash_ignores_provenance_and_order_but_not_money_or_count(self):
        row = {"id": "OP-1", "source_ref": "OP-1", "source_file": "/first.csv", "source_sha256": "first", "physical_row": 3, "gross": "30.00"}
        contract = {"id": "RATE-old", "product": "DEBITO", "cnpj": "111", "rate_pct": "1.5", "source_ref": "Sheet!A3", "revision_id": "old"}
        old = {"rows": [row, {**row, "id": "OP-2"}], "contracts": [contract]}
        changed = deepcopy(old)
        changed["rows"].reverse()
        for entry in changed["rows"]: entry.update(source_file="/new/location.csv", source_sha256="other", physical_row=90)
        changed["contracts"][0].update(id="RATE-new", source_ref="Sheet!A80", revision_id="new")
        self.assertEqual(digest(semantic(old)), digest(semantic(changed)))
        changed["rows"][0]["gross"] = "30.01"
        self.assertNotEqual(digest(semantic(old)), digest(semantic(changed)))
        self.assertNotEqual(digest(semantic(old)), digest(semantic({**old, "rows": old["rows"] * 2})))

    def test_decisions_require_refresh_and_resolved_issues_are_excluded(self):
        item = self.review()
        resolved = item["items"][0]["id"]
        exception = next(e for e in self.flow.contexts["run-1"]["exceptions"] if e["id"] == resolved)
        exception["status"] = "accepted"
        self.assertTrue(self.service.get(item["id"])["stale"])
        self.assert_error("SUGGESTION_REVIEW_REQUIRED", lambda: self.approve(item))
        self.assert_error("SUGGESTION_EVIDENCE_CHANGED", lambda: self.service.edit(item["id"], {"version": item["version"]}, ACTOR, ACCOUNT))
        updated = self.service.edit(item["id"], {"version": item["version"], "refresh_evidence": True}, ACTOR, ACCOUNT)
        self.assertEqual(updated["item_count"], item["item_count"] - 1)
        self.assertNotIn(resolved, {i["id"] for i in updated["items"]})
        self.assertFalse(updated["stale"])
        self.assertNotEqual(updated["content_hash"], item["content_hash"])
        self.assertEqual(self.auth.sent, [])

    def test_ambiguous_contact_blocks_even_explicit_to_and_dismiss_requires_reason(self):
        item = self.review()
        for index in (1, 2):
            self.mail.save_contact({"id": f"orbe-{index}", "counterparty": "orbe", "email": f"contact{index}@example.com", "enabled": True}, ACTOR)
        changed = self.service.edit(item["id"], {"version": item["version"], "to": "chosen@example.com"}, ACTOR, ACCOUNT)
        self.assertIn("CONTACT_AMBIGUOUS", {b["code"] for b in changed["blockers"]})
        self.assert_error("SUGGESTION_REVIEW_REQUIRED", lambda: self.approve(changed))
        self.assert_error("JUSTIFICATION_REQUIRED", lambda: self.service.dismiss(item["id"], {"version": changed["version"]}, ACTOR))
        dismissed = self.service.dismiss(item["id"], {"version": changed["version"], "reason": "Contato será esclarecido internamente"}, ACTOR)
        self.assertEqual(dismissed["status"], "dismissed")
        self.assertEqual(self.service.on_run(self.flow.get_run("run-1"))[0]["run_id"], "run-1")
        self.assertEqual(self.service.get(item["id"])["status"], "dismissed")
        self.assertEqual(self.auth.sent, [])

    def test_known_failure_requires_new_review_uncertain_never_retries(self):
        item = self.review()
        self.auth.result = KnownSendFailure()
        failed = self.approve(item)
        self.assertEqual(failed["status"], "failed")
        self.assert_error("SUGGESTION_SEND_LOCKED", lambda: self.approve(failed))
        reviewed = self.review(failed)
        self.auth.result = TimeoutError("secret provider details")
        uncertain = self.approve(reviewed)
        self.assertEqual(uncertain["status"], "uncertain")
        self.assertNotIn("secret", canonical(uncertain))
        self.assert_error("SUGGESTION_NOT_EDITABLE", lambda: self.review(uncertain))
        self.flow.clone("run-2")
        duplicate = self.review(self.selected("run-2"))
        self.assertEqual(duplicate["duplicate_of"], uncertain["id"])
        self.assertEqual(len(self.auth.sent), 2)

    def test_tampered_output_input_or_attachment_never_reaches_provider(self):
        item = self.review()
        file = item["attachments"][0]
        self.service.db.execute("UPDATE mail_suggestion_attachments SET content=? WHERE id=?", (b"altered", file["id"]))
        self.assert_error("SUGGESTION_ATTACHMENT_CHANGED", lambda: self.approve(item))
        self.assertEqual(self.service._get(item["id"])["status"], "suggested")
        self.flow.path.write_text("altered output")
        self.assertIn("DATASET_CHANGED", {b["code"] for b in self.service.get(item["id"])["blockers"]})
        self.assert_error("DATASET_CHANGED", lambda: self.approve(item))
        source = self.flow.runs["run-1"]["snapshot"]["sources"][0]
        Path(source["snapshot_path"]).write_text("altered original")
        self.assertIn("INPUT_CHANGED", {b["code"] for b in self.service.get(item["id"])["blockers"]})
        self.assertEqual(self.auth.sent, [])

    def test_double_click_separate_connections_claim_exactly_once(self):
        item = self.review()
        other = SuggestionService(self.path, self.flow, self.mail, self.auth)
        entered, finish, outcomes = threading.Event(), threading.Event(), []
        original = self.auth.send_message
        def sending(context, raw):
            entered.set()
            finish.wait(5)
            return original(context, raw)
        self.auth.send_message = sending
        first = threading.Thread(target=lambda: outcomes.append(self.approve(item)))
        first.start()
        self.assertTrue(entered.wait(5))
        errors = []
        def duplicate():
            try: other.approve_send(item["id"], {"version": item["version"], "content_hash": item["content_hash"], "permission": True}, ACTOR, ACCOUNT)
            except ServiceError as exc: errors.append(exc.code)
        second = threading.Thread(target=duplicate)
        second.start()
        finish.set(); first.join(5); second.join(5); other.close()
        self.assertEqual(outcomes[0]["status"], "sent")
        self.assertEqual(errors, ["SUGGESTION_SEND_LOCKED"])
        self.assertEqual(len(self.auth.sent), 1)

    def test_interrupted_send_recovers_as_uncertain(self):
        item = self.review()
        class ProcessInterrupted(BaseException): pass
        self.auth.result = ProcessInterrupted()
        with self.assertRaises(ProcessInterrupted): self.approve(item)
        self.assertEqual(self.service._get(item["id"])["status"], "sending")
        self.service.close()
        self.service = SuggestionService(self.path, self.flow, self.mail, self.auth)
        self.assertEqual(self.service.get(item["id"])["status"], "uncertain")
        self.assert_error("SUGGESTION_SEND_LOCKED", lambda: self.approve(item))


if __name__ == "__main__": unittest.main()
