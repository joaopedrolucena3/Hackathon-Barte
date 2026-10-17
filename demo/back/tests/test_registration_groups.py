"""Registration is a merchant cause, while amounts and evidence remain per operation."""
import copy
import csv
import json
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from src.engine import calculate
from src.pipeline.steps import _annotate, _from_issue, _post_pair, execute_step, export_artifacts


CNPJ = "12345678000123"


def merchant(cnpj=CNPJ, ec="EC1", **extra):
    return {"cnpj": cnpj, "ec": ec, "name": "Empresa Exemplo", "candidate": True,
            "active": False, "source_file": "cadastro.xlsx", "source_ref": "Cadastro!2", **extra}


def checkout(ident="T1", **extra):
    return {"id": ident, "date": "2026-09-15", "ec": "EC1", "name": "Empresa Exemplo",
            "type": "VENDA", "modality": "PIX", "installments": 1, "brand": "",
            "gross": "100.00", "applied_rate_pct": "2.00", "reported_fee": "2.00", "net": "98.00",
            "original_id": "", "original_date": "", "source_file": "orbe.csv",
            "source_ref": ident, "physical_row": 2, **extra}


def remittance(ident="R1", **extra):
    return {"id": ident, "contracted_date": "2026-09-16", "cnpj": CNPJ, "name": "Empresa Exemplo",
            "spread_brl": "10.01", "compliance": "APROVADO", "source_file": "ponte.xlsx",
            "source_ref": ident, "physical_row": 4, **extra}


def fixture():
    return {"merchants": [merchant()], "checkout": [], "remittances": [], "rates": [],
            "bank": [], "accounts": [], "sources": [], "import_warnings": []}


def grouped(result):
    return [p for p in result["pendencias"] if p["tipo"] == "CADASTRO_NAO_CONFIRMADO"]


def pipeline(data):
    ctx = {"period": "2026-09", "scratch": {}, "exceptions": [], "datasets": {
        "raw_orbe": copy.deepcopy(data["checkout"]), "raw_remittances": copy.deepcopy(data["remittances"]),
        "raw_merchants": copy.deepcopy(data["merchants"]), "raw_rates": copy.deepcopy(data["rates"]),
        "raw_bank": [], "accounts": [], "sources": [], "bank_balances": [], "bancos_classificados": []}}
    for step in ("normalizar_orbe", "resolver_lojista", "conferir_mdr", "vincular_estornos", "processar_cambio"):
        result = execute_step(step, ctx, {})
        for exception in result.exceptions: exception["step_id"] = step
        ctx["datasets"].update(result.datasets)
        ctx["exceptions"].extend(result.exceptions)
    return ctx


class RegistrationGroupingTests(unittest.TestCase):
    def test_one_company_has_one_cause_with_signed_amounts_and_every_trace(self):
        data = fixture()
        data["checkout"] = [checkout("T2", reported_fee="-0.50", physical_row=3), checkout()]
        before = copy.deepcopy(data)
        result = calculate(data)
        group, = grouped(result)
        self.assertEqual(group["operation_count"], 2)
        self.assertEqual(group["valor_brl"], "1.50")
        self.assertEqual(group["group_scope"], "merchant_period")
        self.assertEqual(group["period"], "2026-09")
        self.assertEqual(group["merchant_name"], "Empresa Exemplo")
        self.assertEqual(group["exposure_status"], "complete")
        self.assertNotIn("Atlas", group["motivo"] + group["rule"])
        traces = [r for r in result["rastro"] if r["id_saida"] == group["id_saida"]]
        self.assertEqual(len(traces), 2)
        self.assertEqual(sum(Decimal(r["valor"]) for r in traces), Decimal(group["valor_brl"]))
        self.assertEqual(data, before)
        self.assertFalse(result["comissoes"])
        self.assertFalse(result["notas"])

    def test_exact_cnpj_separates_identically_named_companies_and_periods(self):
        data = fixture()
        data["merchants"].append(merchant("99999999000199", "EC2"))
        data["checkout"] = [checkout(), checkout("T2", ec="EC2"), checkout("OCT", date="2026-10-02")]
        september = grouped(calculate(data, {"period": "2026-09"}))
        self.assertEqual({g["cnpj"] for g in september}, {CNPJ, "99999999000199"})
        self.assertTrue(all(g["operation_count"] == 1 for g in september))
        october, = grouped(calculate(data, {"period": "2026-10"}))
        self.assertNotIn(october["id_saida"], {g["id_saida"] for g in september})
        self.assertEqual(october["affected_operations"][0]["id"], "OCT")

    def test_duplicates_count_once_but_preserve_all_receipts_and_separate_alert(self):
        data = fixture()
        original = checkout()
        original["provenances"] = [{"source_file": "archive.csv", "source_ref": "OLDREF", "physical_row": 50,
                                      "source_sha256": "oldhash", "receipt_id": "oldreceipt"}]
        data["checkout"] = [original, checkout(source_file="copy.csv", source_ref="COPYREF", physical_row=20)]
        result = calculate(data)
        group, = grouped(result)
        self.assertEqual((group["operation_count"], group["valor_brl"]), (1, "2.00"))
        self.assertEqual({(e["arquivo"], e["ref"], e["linha"]) for e in group["evidence"]},
                         {("orbe.csv", "T1", 2), ("copy.csv", "COPYREF", 20), ("archive.csv", "OLDREF", 50)})
        self.assertTrue(any(e.get("receipt_id") == "oldreceipt" for e in group["evidence"]))
        self.assertEqual(len([p for p in result["pendencias"] if p["tipo"] == "DUPLICIDADE"]), 1)
        self.assertEqual(len([r for r in result["rastro"] if r["id_saida"] == group["id_saida"]]), 1)

    def test_reordering_members_and_provenances_does_not_change_group(self):
        data = fixture()
        data["checkout"] = [checkout("T2"), checkout()]
        data["checkout"][0]["provenances"] = [{"source_file": "z.csv", "source_ref": "Z", "physical_row": 8},
                                                  {"source_file": "a.csv", "source_ref": "A", "physical_row": 9}]
        data["remittances"] = [remittance("R2"), remittance()]
        first = grouped(calculate(data))
        data["checkout"][0]["provenances"].reverse()
        data["checkout"].reverse()
        data["remittances"].reverse()
        self.assertEqual(first, grouped(calculate(data)))

    def test_member_value_evidence_and_merchant_changes_invalidate_fingerprint(self):
        data = fixture()
        data["checkout"] = [checkout(), checkout("T2")]
        original, = grouped(calculate(data))
        variants = []
        changed = copy.deepcopy(data); changed["checkout"].pop(); variants.append(changed)
        changed = copy.deepcopy(data); changed["checkout"][0]["reported_fee"] = "3.00"; variants.append(changed)
        changed = copy.deepcopy(data); changed["checkout"][0]["source_sha256"] = "changed"; variants.append(changed)
        changed = copy.deepcopy(data); changed["merchants"][0]["source_ref"] = "Cadastro!3"; variants.append(changed)
        changed = copy.deepcopy(data); changed["merchants"][0]["active"] = True; variants.append(changed)
        for variant in variants:
            with self.subTest(variant=variant):
                group, = grouped(calculate(variant))
                self.assertEqual(original["id_saida"], group["id_saida"])
                self.assertNotEqual(original["source_fingerprint"], group["source_fingerprint"])

    def test_other_registration_failures_remain_per_operation(self):
        for expected, merchants, edits in [
            ("CADASTRO_AUSENTE", [], {}),
            ("CADASTRO_AMBIGUO", [merchant(), merchant("99999999000199")], {}),
            ("CNPJ_INVALIDO", [merchant("invalid")], {}),
        ]:
            with self.subTest(expected=expected):
                data = fixture(); data["merchants"] = merchants
                data["checkout"] = [checkout("T1", **edits), checkout("T2", **edits)]
                result = calculate(data)
                self.assertFalse(grouped(result))
                matching = [p for p in result["pendencias"] if p["tipo"] == expected]
                self.assertEqual(len(matching), 2)
                self.assertTrue(all("group_scope" not in p for p in matching))

    def test_unknown_exposure_is_nullable_with_explicit_known_subtotal(self):
        data = fixture()
        data["checkout"] = [checkout(reported_fee=None)]
        data["remittances"] = [remittance()]
        result = calculate(data)
        group, = grouped(result)
        self.assertIsNone(group["valor_brl"])
        self.assertEqual((group["known_exposure_brl"], group["missing_exposure_count"], group["exposure_status"]), ("10.01", 1, "partial"))
        self.assertIsNone(group["affected_operations"][0]["exposure_brl"])
        self.assertTrue(any(r["valor"] is None for r in result["rastro"] if r["id_saida"] == group["id_saida"]))
        self.assertTrue(any(p["tipo"] == "VALOR_INVALIDO" for p in result["pendencias"]))
        data["remittances"] = []
        only, = grouped(calculate(data))
        self.assertIsNone(only["valor_brl"])
        self.assertEqual(only["exposure_status"], "unavailable")

    def test_regularizing_registration_does_not_authorize_missing_contract(self):
        data = fixture(); data["checkout"] = [checkout()]
        data["merchants"][0].update(candidate=False, active=True)
        result = calculate(data)
        self.assertFalse(grouped(result))
        self.assertTrue(any(p["tipo"] == "TAXA_AUSENTE" for p in result["pendencias"]))
        self.assertFalse(result["comissoes"])
        self.assertFalse(result["notas"])

    def test_exposure_rounds_each_operation_before_aggregation(self):
        data = fixture(); data["checkout"] = [checkout("T1", reported_fee="1.005"), checkout("T2", reported_fee="1.005")]
        result = calculate(data)
        group, = grouped(result)
        self.assertEqual(group["valor_brl"], "2.02")
        self.assertEqual([op["exposure_brl"] for op in group["affected_operations"]], ["1.01", "1.01"])
        traces = [r for r in result["rastro"] if r["id_saida"] == group["id_saida"]]
        self.assertEqual(sum(Decimal(r["valor"]) for r in traces), Decimal("2.02"))


class RegistrationPipelineTests(unittest.TestCase):
    def test_mixed_business_group_is_emitted_once_and_links_every_operation(self):
        data = fixture(); data["checkout"] = [checkout("PC-CHECKOUT"), checkout("T2")]
        data["remittances"] = [remittance("CUSTOM-REMITTANCE")]
        ctx = pipeline(data)
        groups = [e for e in ctx["exceptions"] if e["tipo"] == "CADASTRO_NAO_CONFIRMADO"]
        self.assertEqual(len(groups), 1)
        group = groups[0]
        self.assertEqual(group["step_id"], "resolver_lojista")
        self.assertEqual((group["operation_count"], group["impacto_rs"]), (3, "14.01"))
        for name in ("orbe_resolvido", "mdr_conferido", "checkout_calculado", "cambio_calculado"):
            self.assertTrue(all(group["id"] in r["__exception_ids"] for r in ctx["datasets"][name]), name)
        self.assertTrue(all(not r.get("calculated") for r in ctx["datasets"]["checkout_calculado"] + ctx["datasets"]["cambio_calculado"]))

    def test_remittance_only_group_has_no_prefix_dependency_or_duplicate(self):
        data = fixture(); data["remittances"] = [remittance("ANY-ID"), remittance("ANOTHER")]
        ctx = pipeline(data)
        groups = [e for e in ctx["exceptions"] if e["tipo"] == "CADASTRO_NAO_CONFIRMADO"]
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["step_id"], "processar_cambio")
        self.assertTrue(all(groups[0]["id"] in r["__exception_ids"] for r in ctx["datasets"]["cambio_calculado"]))

    def test_exact_source_scope_does_not_link_same_reference_in_bank_or_other_line(self):
        data = fixture(); data["checkout"] = [checkout()]
        group = _from_issue(grouped(calculate(data))[0])
        same = checkout()
        other_file = {**same, "source_file": "bank.csv"}
        other_line = {**same, "physical_row": 99}
        annotated = _annotate([same, other_file, other_line], [group])
        self.assertEqual([r["__exception_ids"] for r in annotated], [[group["id"]], [], []])
        ledger = []
        _post_pair(ledger, "BANCO", other_file, "25.00", "D", "C", "Crédito válido", [group])
        self.assertTrue(all(r["__exception_ids"] == [] for r in ledger))
        ctx = {"approved": True, "exceptions": [group], "datasets": {"lancamentos": ledger,
               "accounts": [{"code": code, "postable": True} for code in ("D", "C")]}}
        with tempfile.TemporaryDirectory() as folder:
            result = export_artifacts(ctx, [{"exception_id": group["id"], "acao": "excluir", "justificativa": "Manter cadastro pendente"}], folder)
            self.assertEqual(result["rows"], 2)
            self.assertEqual(result["debit_total"], "25.00")

    def test_export_preserves_group_members_evidence_fingerprint_and_decision(self):
        data = fixture(); data["checkout"] = [checkout()]
        group = _from_issue(grouped(calculate(data))[0])
        group["decision"] = {"acao": "excluir", "source_fingerprint": group["source_fingerprint"], "billing_authorized": False}
        ctx = {"approved": True, "exceptions": [group], "datasets": {"lancamentos": [], "accounts": []}}
        adjustment = {"exception_id": group["id"], "acao": "excluir", "justificativa": "Permanece retido", "billing_authorized": False}
        with tempfile.TemporaryDirectory() as folder:
            export_artifacts(ctx, [adjustment], folder)
            with (Path(folder) / "relatorio_excecoes.csv").open() as source:
                row = next(csv.DictReader(source, delimiter=";"))
            self.assertEqual(row["operation_count"], "1")
            self.assertEqual(json.loads(row["affected_operations"]), group["affected_operations"])
            self.assertEqual(json.loads(row["origens"]), group["origens"])
            self.assertEqual(json.loads(row["decision"]), group["decision"])
            with (Path(folder) / "ajustes.csv").open() as source:
                adjustment_row = next(csv.DictReader(source, delimiter=";"))
            self.assertEqual(adjustment_row["source_fingerprint"], group["source_fingerprint"])
            self.assertEqual(adjustment_row["cnpj"], CNPJ)
            self.assertEqual(json.loads(adjustment_row["affected_operations"]), group["affected_operations"])

    def test_same_filename_reference_and_line_cannot_override_source_identity(self):
        source = checkout(source_file="relatorio.csv", source_sha256="checkout-hash",
                          source_receipt_id="checkout-receipt", source_id="checkout-source")
        data = fixture(); data["checkout"] = [source]
        group = _from_issue(grouped(calculate(data))[0])
        self.assertNotIn("source_sha256", group["affected_operations"][0])
        for identity_field in ("source_sha256", "source_receipt_id", "source_id"):
            for replacement in ("bank-identity", None):
                with self.subTest(identity_field=identity_field, replacement=replacement):
                    bank = {**source, identity_field: replacement, "bank": "AURORA", "amount": "25.00"}
                    bank.pop("cnpj", None)
                    annotated = _annotate([source, bank], [group])
                    self.assertEqual([r["__exception_ids"] for r in annotated], [[group["id"]], []])
                    ledger = []
                    _post_pair(ledger, "BANCO", bank, "25.00", "D", "C", "Crédito válido", [group])
                    self.assertTrue(all(r["__exception_ids"] == [] for r in ledger))
                    ctx = {"approved": True, "exceptions": [group], "datasets": {"lancamentos": ledger,
                           "accounts": [{"code": code, "postable": True} for code in ("D", "C")]}}
                    with tempfile.TemporaryDirectory() as folder:
                        result = export_artifacts(ctx, [{"exception_id": group["id"], "acao": "excluir", "justificativa": "Manter cadastro pendente"}], folder)
                        self.assertEqual(result["rows"], 2)
                        self.assertEqual(result["debit_total"], "25.00")


if __name__ == "__main__": unittest.main()
