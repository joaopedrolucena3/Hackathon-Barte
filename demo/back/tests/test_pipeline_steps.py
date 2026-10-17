"""Pipeline contracts, financial safeguards and independent reproducibility checks."""
import copy
import hashlib
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from src.pipeline.registry import catalog, default_definition, validate_definition
from src.pipeline.datasets import write_dataset, read_dataset, preview
from src.pipeline.steps import StepResult, execute_step, export_artifacts, validate_ledger


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / 'data' / 'case'


def run_until_gate(destination):
    ctx = {"period": "2026-09", "source_dir": str(PACK), "datasets": {}, "scratch": {}, "exceptions": [], "export_dir": Path(destination) / "export"}
    hashes = {}
    for step in default_definition()["steps"]:
        if step["type"] == "exportar_erp": break
        result = execute_step(step["type"], ctx, step["params"])
        for exception in result.exceptions: exception["step_id"] = step["id"]
        ctx["exceptions"].extend(result.exceptions)
        for name, rows in result.datasets.items():
            metadata = write_dataset(Path(destination) / (name + ".parquet"), rows)
            hashes[name] = metadata["sha256"]
            # Persistence roundtrip on every step simulates context reconstruction.
            ctx["datasets"][name] = read_dataset(metadata["path"])
    return ctx, hashes


class PipelineDefinitionTests(unittest.TestCase):
    def test_default_definition_is_valid_and_gate_is_mandatory(self):
        definition = default_definition()
        self.assertFalse(validate_definition(definition))
        definition["steps"] = [s for s in definition["steps"] if s["type"] != "aprovacao"]
        self.assertIn("APPROVAL_REQUIRED", {e["code"] for e in validate_definition(definition)})

    def test_gate_cannot_precede_later_mutation(self):
        definition = default_definition()
        definition["steps"][-3], definition["steps"][-2] = definition["steps"][-2], definition["steps"][-3]
        codes = {e["code"] for e in validate_definition(definition)}
        self.assertIn("APPROVAL_EXPORT_ORDER", codes)
        self.assertIn("MISSING_DEPENDENCY", codes)

    def test_parameters_unknown_types_and_duplicate_producers_are_invalid(self):
        definition = default_definition()
        definition["steps"][6]["params"]["participacao_spread"] = 0.9
        definition["steps"][1]["type"] = "inventar_taxas"
        definition["steps"].insert(2, copy.deepcopy(definition["steps"][0]))
        codes = {e["code"] for e in validate_definition(definition)}
        self.assertTrue({"PARAMS_SCHEMA", "UNKNOWN_STEP", "DUPLICATE_STEP_ID", "DUPLICATE_STEP_TYPE"} <= codes)

    def test_non_finite_params_are_not_json_schema_valid(self):
        definition = default_definition()
        definition["steps"][6]["params"]["tolerancia_pp"] = float("nan")
        self.assertTrue(validate_definition(definition))

    def test_catalog_exposes_code_fingerprint(self):
        entries = catalog()
        self.assertEqual(len(entries), 10)
        for entry in entries:
            self.assertEqual(len(entry["code_sha256"]), 64)
            self.assertIn(entry["code_sha256"][:12], entry["version"])


class PreviewTests(unittest.TestCase):
    def test_decimal_strings_roundtrip_and_filters_are_numeric(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "data.parquet"
            rows = [{"id": "one", "valor_brl": "2.00", "__exception_ids": []}, {"id": "two", "valor_brl": "10.01", "__exception_ids": ["E"]}]
            write_dataset(path, rows)
            self.assertEqual(read_dataset(path), rows)
            page = preview(path, {"filters": [{"column": "valor_brl", "op": "gt", "value": "9"}], "only_exceptions": True})
            self.assertEqual(page["total"], 1)
            self.assertEqual(page["rows"][0]["valor_brl"], "10.01")

    def test_preview_diff_and_page_size_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "data.parquet"
            write_dataset(path, [{"id": "new", "valor_brl": "1.23"}])
            page = preview(path, {"diff": True}, [{"id": "old"}])
            self.assertEqual(page["diff"]["added"], 1)
            self.assertEqual(page["diff"]["removed"], 1)
            self.assertEqual(page["diff"]["new_columns"], ["valor_brl"])
            self.assertTrue(next(c for c in page["schema"] if c["name"] == "valor_brl")["new"])
            with self.assertRaises(ValueError): preview(path, {"page_size": 501})


class PipelineCaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.ctx, cls.hashes = run_until_gate(Path(cls.temp.name) / "first")

    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()

    def test_case_financial_totals_and_analytic_balanced_ledger(self):
        data = self.ctx["datasets"]
        checkout = sum(Decimal(r["comissao_brl"]) for r in data["comissoes"] if r["linha_negocio"] == "CHECKOUT")
        remessa = sum(Decimal(r["comissao_brl"]) for r in data["comissoes"] if r["linha_negocio"] == "REMESSA")
        self.assertEqual(checkout, Decimal("207039.73"))
        self.assertEqual(remessa, Decimal("39543.45"))
        self.assertFalse(validate_ledger(data["lancamentos"], data["accounts"]))
        self.assertEqual(sum(Decimal(r["debito"]) for r in data["lancamentos"]), sum(Decimal(r["credito"]) for r in data["lancamentos"]))
        self.assertTrue(any(e["tipo"] == "MAPA_CONTABIL_A_CONFIRMAR" for e in self.ctx["exceptions"]))
        self.assertFalse(any("RESSALVA" in e["tipo"] for e in self.ctx["exceptions"]))

    def test_export_requires_approval_and_can_resume_without_scratch(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = copy.deepcopy(self.ctx)
            with self.assertRaises(PermissionError): export_artifacts(ctx, [], tmp)
            ctx.update(approved=True, scratch={})
            result = export_artifacts(ctx, [], tmp)
            self.assertEqual(result["debit_total"], result["credit_total"])
            self.assertTrue((Path(tmp) / "lancamentos_fenix.csv").exists())

    def test_two_distinct_run_paths_produce_identical_parquet_and_csv_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            other, hashes = run_until_gate(tmp)
            self.assertEqual(self.hashes, hashes)
            original = copy.deepcopy(self.ctx)
            original["approved"] = other["approved"] = True
            one = export_artifacts(original, [], Path(tmp) / "one")
            two = export_artifacts(other, [], Path(tmp) / "two")
            self.assertEqual(one, two)
            self.assertTrue(all(not str(s.get("path", "")).startswith("/") for s in other["datasets"]["sources"]))

    def test_adjustment_is_applied_to_both_sides_without_mutating_raw(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = copy.deepcopy(self.ctx)
            ctx["approved"] = True
            exception = next(e for e in ctx["exceptions"] if e["tipo"] == "CREDITO_NAO_IDENTIFICADO")
            before = copy.deepcopy(ctx["datasets"]["lancamentos"])
            adjustment = {"exception_id": exception["id"], "acao": "ajustar", "valor": "7000.00", "conta": "1.1.09.002", "justificativa": "Valor confirmado em documento revisado", "actor": "Analista"}
            result = export_artifacts(ctx, [adjustment], tmp)
            self.assertEqual(result["adjustments_applied"], 1)
            self.assertEqual(result["debit_total"], result["credit_total"])
            self.assertEqual(ctx["datasets"]["lancamentos"], before)
            content = (Path(tmp) / "lancamentos_fenix.csv").read_text()
            self.assertIn("7000.00", content)

    def test_atlas_cannot_create_revenue_by_adjustment_but_can_be_excluded(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = copy.deepcopy(self.ctx); ctx["approved"] = True
            exception = next(e for e in ctx["exceptions"] if e["tipo"] == "CADASTRO_NAO_CONFIRMADO")
            adjustment = {"exception_id": exception["id"], "acao": "ajustar", "valor": "100.00", "justificativa": "Revisão", "actor": "Analista"}
            with self.assertRaises(ValueError): export_artifacts(ctx, [adjustment], tmp)
            adjustment["acao"] = "excluir"
            result = export_artifacts(ctx, [adjustment], tmp)
            self.assertEqual(result["rows"], len(ctx["datasets"]["lancamentos"]))

    def test_zero_adjustment_with_valid_account_removes_both_sides(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = copy.deepcopy(self.ctx); ctx["approved"] = True
            exception = next(e for e in ctx["exceptions"] if e["tipo"] == "CREDITO_NAO_IDENTIFICADO")
            before = copy.deepcopy(ctx["datasets"]["lancamentos"])
            target = [r for r in before if exception["id"] in r["__exception_ids"]]
            self.assertEqual(len(target), 2)
            adjustment = {"exception_id": exception["id"], "acao": "ajustar", "valor": "0.00",
                          "conta": "1.1.09.002", "justificativa": "Anular partida revisada", "actor": "Analista"}
            result = export_artifacts(ctx, [adjustment], tmp)
            self.assertEqual(result["rows"], len(before) - 2)
            self.assertEqual(result["debit_total"], result["credit_total"])
            self.assertNotIn(target[0]["entry_id"], (Path(tmp) / "lancamentos_fenix.csv").read_text())
            self.assertEqual(ctx["datasets"]["lancamentos"], before)
            with self.assertRaises(ValueError):
                export_artifacts(ctx, [{**adjustment, "conta": "1"}], tmp)

    def test_synthetic_account_and_non_finite_adjustment_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = copy.deepcopy(self.ctx); ctx["approved"] = True
            exception = next(e for e in ctx["exceptions"] if e["tipo"] == "CREDITO_NAO_IDENTIFICADO")
            base = {"exception_id": exception["id"], "acao": "ajustar", "justificativa": "Revisão"}
            with self.assertRaises(ValueError): export_artifacts(ctx, [{**base, "conta": "1"}], tmp)
            with self.assertRaises(ValueError): export_artifacts(ctx, [{**base, "valor": "NaN"}], tmp)

    def test_missing_source_is_a_hard_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError): execute_step("ler_arquivos", {"source_dir": tmp, "datasets": {}}, {})

    def test_normalized_installments_and_exact_cnpj_fallback_reach_real_calculation(self):
        data = self.ctx["datasets"]
        merchant = next(m for m in data["raw_merchants"] if m["cnpj"] == "22224579000109")
        source = next(copy.deepcopy(r) for r in data["raw_orbe"] if r["ec"] == merchant["ec"] and r["type"] == "VENDA")
        source.update(id="TEST-CNPJ", source_ref="TEST-CNPJ", ec="NEW-EC", cnpj=merchant["cnpj"], date="2026-09-14",
                      modality="CREDITO PARCELADO", installments=1, gross="100.00", reported_fee="2.59", net="97.41", applied_rate_pct="2.59")
        ctx = {"period": "2026-09", "datasets": {"raw_orbe": [source], "raw_merchants": data["raw_merchants"], "raw_rates": data["raw_rates"]}, "scratch": {}, "exceptions": []}
        for typ in ("normalizar_orbe", "resolver_lojista", "conferir_mdr"):
            result = execute_step(typ, ctx, {})
            ctx["datasets"].update(result.datasets)
            ctx["exceptions"].extend(result.exceptions)
        row = ctx["datasets"]["mdr_conferido"][0]
        self.assertEqual(row["modality"], "CREDITO A VISTA")
        self.assertEqual(row["match_method"], "CNPJ")
        self.assertEqual(row["comissao_brl"], "2.59")
        self.assertFalse(any(e["tipo"] == "CADASTRO_AUSENTE" for e in ctx["exceptions"]))


if __name__ == "__main__": unittest.main()
