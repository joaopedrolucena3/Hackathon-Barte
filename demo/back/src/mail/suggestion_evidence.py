"""Evidence and language for suggestions, using preserved run data only."""
from __future__ import annotations

import copy
import csv
from decimal import Decimal
import hashlib
import html
import io
from pathlib import Path
import threading

from ..pipeline.service import ServiceError
from .evidence import build_evidence, canonical, digest, _table


KINDS = {
    "DIVERGENCIA_TAXA": ("Divergências de taxa", "As taxas aplicadas divergem das referências contratuais preservadas nesta execução.", "Solicitar a conferência das taxas e o esclarecimento ou correção das diferenças demonstradas."),
    "DUPLICIDADE": ("Operações duplicadas", "O mesmo identificador aparece em mais de uma linha; a execução contabilizou a operação uma única vez.", "Solicitar confirmação das linhas repetidas e, se necessário, um relatório corrigido."),
    "DUPLICIDADE_CONFLITANTE": ("Duplicidades com valores distintos", "O mesmo identificador apresenta versões conflitantes; a execução não escolheu uma versão para contabilizar.", "Solicitar a versão correta da operação e a explicação das diferenças entre as linhas."),
    "CONFERIR_REPASSE_PONTE": ("Conferência do repasse", "A execução identifica uma base faturada à Ponte que depende de confirmação do crédito bancário.", "Solicitar o demonstrativo do repasse e o extrato que confirme valor e data efetivamente creditados."),
    "SPREAD_NEGATIVO": ("Operações com spread negativo", "O spread negativo foi preservado como pendência e excluído da comissão e da nota fiscal.", "Solicitar esclarecimento da operação e da taxa utilizada, com o demonstrativo correspondente."),
}


class RunEvidenceStore:
    """Minimal read-only adapter; never calls the mutable financial Store."""
    def __init__(self, run, context):
        snapshots = context["datasets"].get("resultado_snapshot", [])
        if len(snapshots) != 1 or not isinstance(snapshots[0], dict):
            raise ServiceError(409, "RUN_EVIDENCE_UNAVAILABLE", "Esta execução não preservou o resultado necessário. As sugestões não serão recalculadas com os dados atuais; faça uma nova execução.")
        self.lock = threading.RLock()
        self.result = copy.deepcopy(snapshots[0])
        datasets, references = context["datasets"], context.get("references", {})
        parameters = {}
        completed = {step["id"] for step in run.get("steps", []) if step.get("status") in {"done", "done_with_exceptions"}}
        for step in run["snapshot"].get("definition", {}).get("steps", []):
            if step.get("type") == "processar_cambio" and step["id"] in completed:
                effective = run["snapshot"].get("effective_parameters", {}).get(step["id"], {})
                tolerance = effective.get("tolerancia_pp")
                if tolerance is not None:
                    # Match _computed's explicit override/default selection,
                    # without running the financial engine again.
                    parameters["remittance_tolerance_pp"] = str(references.get("parameters", {}).get("remittance_tolerance_pp", tolerance) if Decimal(str(tolerance)) == Decimal("0.002") else tolerance)
        self.values = {"period": run["competencia"], "parameters": parameters,
                       "source_data": {"checkout": datasets.get("raw_orbe", []) + context.get("history_checkout", []),
                                       "remittances": datasets.get("raw_remittances", []), "bank": datasets.get("raw_bank", [])},
                       "merchants": datasets.get("raw_merchants", references.get("merchants", [])),
                       "rates": datasets.get("raw_rates", references.get("rates", []))}

    def _results(self): return self.result
    def get(self, key, default=None): return self.values.get(key, default)
    def records(self, key): return self.values.get(key, [])


def snapshot(flow, run_id):
    """Caller holds flow.lock; validate preserved inputs, references and outputs."""
    run = flow.get_run(run_id)
    if run["status"] not in {"awaiting_approval", "done"}:
        raise ServiceError(409, "RUN_NOT_READY", "As sugestões ficam disponíveis quando a execução termina ou aguarda revisão.")
    for source in run["snapshot"].get("sources", []):
        try: actual = hashlib.sha256(Path(source["snapshot_path"]).read_bytes()).hexdigest()
        except (OSError, KeyError): actual = None
        if actual != source.get("sha256"):
            raise ServiceError(409, "INPUT_CHANGED", "Uma fonte preservada mudou ou está indisponível. Inicie uma nova execução antes de preparar e-mails.")
    for key in ("references", "history"):
        expected = run["snapshot"].get(key + "_hash")
        if expected and expected != digest(run["snapshot"].get(key, {})):
            raise ServiceError(409, "RUN_REFERENCE_CHANGED", "As referências preservadas desta execução foram alteradas. O envio está bloqueado.")
    try: context = flow._context(run)
    except OSError:
        raise ServiceError(409, "RUN_EVIDENCE_UNAVAILABLE", "Uma saída preservada não está disponível. Inicie uma nova execução.") from None
    return run, context, RunEvidenceStore(run, context)


def collect(run, context, adapter):
    """Only currently open, explicitly supported, unambiguous external issues."""
    exceptions = {item["id"]: item for item in context["exceptions"]}
    groups, excluded = {}, []
    for issue in adapter.result.get("pendencias", []):
        ident, kind = issue.get("id_saida"), issue.get("tipo")
        exception = exceptions.get(ident)
        reason = None
        if kind not in KINDS:
            reason = "Pendência interna ou tipo sem encaminhamento externo definido; exige revisão humana."
        elif not exception:
            reason = "A ocorrência não possui estado de revisão preservado nesta execução."
        elif exception.get("status") != "open":
            reason = "A ocorrência já recebeu uma decisão nesta execução; não será sugerida como contestação aberta."
        if reason:
            excluded.append({"id": ident, "kind": kind, "reason": reason})
            continue
        evidence = build_evidence(adapter, ident)
        if evidence["blockers"]:
            excluded.append({"id": ident, "kind": kind, "reason": " ".join(b["message"] for b in evidence["blockers"])})
            continue
        key = (evidence["counterparty"], run["competencia"], kind)
        groups.setdefault(key, []).append(evidence)
    for evidence in groups.values(): evidence.sort(key=lambda item: item["issue"]["id_saida"])
    return groups, excluded


_INCIDENTAL = {"path", "original_path", "snapshot_path", "source_dir", "source_file", "arquivo_origem", "arquivo", "physical_row", "source_row", "linha", "source_id", "source_sha256", "source_receipt_id", "source_fingerprint", "provenances", "id_saida", "divergence_id", "invoice_id", "created_at", "updated_at", "run_id", "at"}


def semantic(value):
    """Ignore location/order/provenance noise, retain operation values and multiplicity."""
    if isinstance(value, dict):
        if "rate_pct" in value and "product" in value:
            # Catalog revision identifiers and spreadsheet cell coordinates can
            # change when the same contract is reimported in another file/order.
            value = {key: value[key] for key in ("cnpj", "product", "rate_pct", "start", "end", "rule", "derived", "exemption") if key in value}
        return {key: semantic(item) for key, item in value.items() if key not in _INCIDENTAL and not key.startswith("__")}
    if isinstance(value, list): return sorted((semantic(item) for item in value), key=canonical)
    return value


def evidence_bundle(key, evidence):
    party, period, kind = key
    bundle = {"counterparty": party, "period": period, "kind": kind, "evidence": evidence}
    # Full hash guards the exact provenance. Semantic hash prevents repeated sends
    # after a rerun, renamed inputs, reordered source rows, or a new connection.
    bundle["evidence_hash"] = digest(bundle)
    business = [{"rows": item["rows"], "contracts": item["contracts"], "parameters": item["parameters"],
                 "calculation": item["calculation"], "reason": item["issue"].get("motivo")} for item in evidence]
    bundle["semantic_hash"] = digest({"counterparty": party, "period": period, "kind": kind, "evidence": semantic(business)})
    bundle["item_hashes"] = {item["issue"]["id_saida"]: digest({"counterparty": party, "period": period, "kind": kind, "evidence": semantic(values)}) for item, values in zip(evidence, business)}
    return bundle


def describe(bundle):
    title, justification, action = KINDS[bundle["kind"]]
    limitations = ["A sugestão depende da revisão e da permissão explícita para esta versão; nenhuma execução envia contestações automaticamente.",
                   "Os valores das ocorrências não são somados nem tratados automaticamente como crédito, reembolso ou cobrança devida.",
                   "As evidências correspondem às fontes e ao resultado preservados da execução selecionada."]
    if bundle["kind"] == "CONFERIR_REPASSE_PONTE": limitations.append("A base faturada não comprova o crédito bancário; confirme o valor e a data no extrato correspondente.")
    items = []
    for evidence in bundle["evidence"]:
        issue = evidence["issue"]
        item = {"id": issue["id_saida"], "reference": str(issue.get("ref_origem", "")), "reason": issue.get("motivo", ""),
                "source_refs": copy.deepcopy(issue.get("evidence", [])), "evidence_hash": evidence["evidence_hash"], "semantic_hash": bundle["item_hashes"][issue["id_saida"]]}
        # A rate difference is specifically defined by the preserved calculation.
        # All other financial amounts remain explicitly labelled in attachments.
        if bundle["kind"] == "DIVERGENCIA_TAXA" and any(d.get("formula") and d.get("contract") for d in evidence["calculation"]):
            item.update(value_brl=issue.get("valor_brl"), value_label="Diferença de taxa calculada (R$), sujeita a conferência")
        items.append(item)
    party = "Orbe" if bundle["counterparty"] == "orbe" else "Ponte Câmbio"
    subject = f"Tarvo | {bundle['period']} | {title} | {len(items)} ocorrência(s)"
    lines = [f"Olá, equipe {party}.", "", f"Na conferência da competência {bundle['period']}, identificamos {len(items)} ocorrência(s) para sua análise.", justification, "", action, "", "Ocorrências e justificativas:"]
    for item in items[:5]:
        lines.append(f"• {item['reference']} — {item['reason']}")
        if item.get("value_brl") is not None: lines.append(f"  {item['value_label']}: {item['value_brl']}.")
    if len(items) > 5: lines.append(f"Há outras {len(items) - 5} ocorrência(s) neste pedido; a lista completa e suas evidências estão nos anexos.")
    lines += ["", "Os anexos contêm apenas as operações relacionadas, suas referências de origem e os cálculos preservados. Os valores expostos não constituem automaticamente um pedido de reembolso; não somamos ocorrências com significados distintos.", "Não estabelecemos prazo de resposta neste pedido.", "", "Obrigado,", "Financeiro Tarvo"]
    return {"title": title, "justification": justification, "recommended_action": action, "limitations": limitations,
            "items": items, "item_count": len(items), "subject": subject, "body": "\n".join(lines)}


def attachment_files(bundle, description):
    rows, seen = [], set()
    sections = []
    for evidence in bundle["evidence"]:
        issue = evidence["issue"]
        sections.append("<section><h2>Ocorrência " + html.escape(issue["id_saida"]) + "</h2>" + _table([issue])
                        + "<h3>Operações relacionadas</h3>" + _table(evidence["rows"])
                        + "<h3>Cadastro e contrato preservados</h3>" + _table(evidence["merchants"]) + _table(evidence["contracts"])
                        + "<h3>Cálculos e rastreabilidade</h3>" + _table(evidence["calculation"]) + _table(evidence["trace"]) + "</section>")
        for row in evidence["rows"]:
            tagged = {"pendencia": issue["id_saida"], **row}
            if canonical(tagged) not in seen:
                rows.append(tagged); seen.add(canonical(tagged))
    document = ("<!doctype html><html lang='pt-BR'><meta charset='utf-8'><title>Sugestão de contestação · Tarvo</title>"
                "<style>body{font:15px/1.5 system-ui;max-width:1000px;margin:32px auto;padding:0 24px;color:#16343b}section{border-top:1px solid #ccd5dd;margin-top:32px}.evidence-card{padding:14px;background:#f4f7f8;break-inside:avoid;margin:12px 0}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}dt{font-size:12px;font-weight:bold}dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}@media(max-width:600px){dl{grid-template-columns:1fr}}</style>"
                + "<h1>" + html.escape(description["title"]) + "</h1><p>Competência: " + html.escape(bundle["period"])
                + " · Contraparte: " + html.escape(bundle["counterparty"]) + "</p><p>" + html.escape(description["justification"])
                + "</p><p>" + html.escape(description["recommended_action"]) + "</p><ul>"
                + "".join("<li>" + html.escape(note) + "</li>" for note in description["limitations"]) + "</ul>"
                + "".join(sections) + "<p>Hash das evidências: " + bundle["evidence_hash"] + "</p></html>")
    stream = io.StringIO(newline="")
    columns = sorted(set().union(*(row.keys() for row in rows)))
    writer = csv.DictWriter(stream, fieldnames=columns, delimiter=";", lineterminator="\n")
    writer.writeheader()
    for row in rows:
        values = {key: canonical(value) if isinstance(value, (list, dict)) else str(value if value is not None else "") for key, value in row.items()}
        # Prefix potential spreadsheet formulas, including whitespace/control prefixes.
        writer.writerow({key: "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value for key, value in values.items()})
    files = [{"name": "evidencias_contestacao.html", "content_type": "text/html", "data": document.encode("utf-8")},
             {"name": "operacoes_contestacao.csv", "content_type": "text/csv", "data": stream.getvalue().encode("utf-8-sig")}]
    for item in files: item.update(size=len(item["data"]), sha256=hashlib.sha256(item["data"]).hexdigest())
    return files
