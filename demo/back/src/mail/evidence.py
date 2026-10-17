"""Small, deterministic evidence bundles scoped to one financial issue.

Routing uses membership in the structured input collections, never merchant
names, filename prefixes, reference prefixes, or email addresses in documents.
"""
from __future__ import annotations

import copy
import csv
import hashlib
import html
import io
import json
from pathlib import Path

from ..pipeline.service import ServiceError


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False, default=str)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def _ref(row):
    return str(row.get("source_ref") or row.get("ref_origem") or row.get("id") or "")


def _product(row):
    if "ANTECIPACAO" in row.get("type", ""): return "ANTECIPACAO"
    if row.get("modality") == "CREDITO PARCELADO":
        try: return "CREDITO_2_6" if int(row.get("installments", 0)) <= 6 else "CREDITO_7_12"
        except (ValueError, TypeError): return None
    return {"PIX": "PIX", "DEBITO": "DEBITO", "CREDITO A VISTA": "CREDITO_A_VISTA"}.get(row.get("modality"))


def _clean(value):
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items() if k not in {"path", "original_path", "snapshot_path", "source_dir"}}
    if isinstance(value, list): return [_clean(v) for v in value]
    return value


def build_evidence(store, issue_id, counterparty=None, counterparty_reason=""):
    with store.lock:
        result = store._results()
        issue = next((p for p in result.get("pendencias", []) if p.get("id_saida") == issue_id), None)
        if issue is None: raise ServiceError(404, "MAIL_ISSUE_NOT_FOUND", "A pendência não existe no fechamento atual.")
        issue = copy.deepcopy(issue)
        period = store.get("period")
        source = store.get("source_data", {})
        merchants = store.records("merchants")
        rates = store.records("rates")
        traces = [copy.deepcopy(r) for r in result.get("rastro", []) if r.get("id_saida") == issue_id]
        details = result.get("details", [])
        if isinstance(details, dict): details = list(details.values())
        linked_ids = {issue_id, issue.get("divergence_id"), issue.get("invoice_id")} - {None}
        details = [copy.deepcopy(d) for d in details if d.get("id_saida") in linked_ids]
        parameters = store.get("parameters", {})
    links = list(issue.get("evidence", []))
    links += [{"arquivo": r.get("arquivo_origem", ""), "ref": r.get("ref_origem", ""), "linha": r.get("source_row", "")} for r in traces]
    rows, matched = [], set()
    for dataset, party in (("checkout", "orbe"), ("remittances", "ponte"), ("bank", None)):
        for original in source.get(dataset, []):
            relevant = [i for i, link in enumerate(links) if str(link.get("arquivo", "")) == str(original.get("source_file", ""))
                        and str(link.get("ref", "")) == _ref(original)
                        and (not link.get("linha") or str(link["linha"]) == str(original.get("physical_row", "")))]
            if relevant:
                matched.update(relevant)
                rows.append({"dataset": dataset, "counterparty": party, "evidence_role": "ocorrencia", **_clean(copy.deepcopy(original))})
    # Referenced originals are relevant evidence, but only from the same EC.
    initial = list(rows)
    for row in initial:
        if row["dataset"] != "checkout" or not row.get("original_id"): continue
        for original in source.get("checkout", []):
            if original.get("id") == row["original_id"] and original.get("ec") == row.get("ec"):
                candidate = {"dataset": "checkout", "counterparty": "orbe", "evidence_role": "operacao_original", **_clean(copy.deepcopy(original))}
                if not any(r["dataset"] == "checkout" and _ref(r) == _ref(candidate) and r.get("physical_row") == candidate.get("physical_row") for r in rows): rows.append(candidate)
    parties = {r["counterparty"] for r in rows if r.get("counterparty")}
    blockers = []
    automatic = next(iter(parties)) if len(parties) == 1 else None
    if len(parties) > 1:
        blockers.append({"code": "MIXED_COUNTERPARTIES", "message": "A pendência mistura Orbe e Ponte. Separe ou corrija as origens antes de compartilhar evidências."})
        selected = None
    elif counterparty:
        if counterparty not in {"orbe", "ponte"}: raise ServiceError(422, "INVALID_COUNTERPARTY", "Selecione Orbe ou Ponte.")
        if automatic and counterparty != automatic:
            blockers.append({"code": "COUNTERPARTY_MISMATCH", "message": "A contraparte escolhida não corresponde às operações estruturadas da pendência."})
            selected = automatic
        elif not automatic and not str(counterparty_reason).strip():
            selected = None
            blockers.append({"code": "COUNTERPARTY_REVIEW_REQUIRED", "message": "Registre a justificativa da contraparte para esta origem ambígua."})
        else: selected = counterparty
    else: selected = automatic
    if selected is None and not blockers:
        blockers.append({"code": "COUNTERPARTY_AMBIGUOUS", "message": "A origem não identifica Orbe ou Ponte. Revise a contraparte e registre a justificativa."})
    if not rows or any(i not in matched for i in range(len(links))):
        blockers.append({"code": "EVIDENCE_INCOMPLETE", "message": "Uma ou mais referências não foram encontradas nos dados atuais. Corrija ou reimporte a origem antes do envio."})
    # No mixed bundle is ever shared, even if a caller supplied an override.
    if len(parties) > 1: rows = []
    related_merchants, pairs = [], set()
    for row in rows:
        choices = [m for m in merchants if (row["dataset"] == "checkout" and m.get("ec") and m.get("ec") == row.get("ec"))
                   or (row["dataset"] == "remittances" and m.get("cnpj") == row.get("cnpj"))]
        for merchant in choices:
            identity = {k: merchant[k] for k in ("cnpj", "name", "ec", "active", "confirmed", "source_file", "source_ref", "identity_rule") if k in merchant}
            if identity not in related_merchants: related_merchants.append(identity)
            product = "REMESSA" if row["dataset"] == "remittances" else _product(row)
            if product: pairs.add((merchant.get("cnpj"), product))
    contracts = [_clean(copy.deepcopy(rate)) for rate in rates if (rate.get("cnpj"), rate.get("product")) in pairs]
    # Derived contracts (e.g. Casa exemption) are part of the trace, too.
    for detail in details:
        contract = detail.get("contract")
        if contract and _clean(contract) not in contracts: contracts.append(_clean(contract))
    safe_details = [{k: _clean(d[k]) for k in ("arquivo_origem", "ref_origem", "source_row", "valor", "regra", "formula", "contract", "motivo") if k in d} for d in details]
    snapshot = {"issue": _clean(issue), "period": period, "counterparty": selected, "routing_method": "structured" if automatic else "human_review" if selected else "unresolved",
                "counterparty_reason": str(counterparty_reason).strip(), "rows": rows, "merchants": related_merchants, "contracts": contracts,
                "trace": _clean(traces), "calculation": safe_details,
                "parameters": {"remittance_tolerance_pp": parameters.get("remittance_tolerance_pp")} if selected == "ponte" else {}}
    return {**snapshot, "evidence_hash": digest(snapshot), "blockers": blockers}


LABELS = {"id": "Identificador", "id_saida": "Pendência", "ref_origem": "Referência de origem", "source_ref": "Referência de origem",
          "source_file": "Arquivo de origem", "arquivo_origem": "Arquivo de origem", "physical_row": "Linha no arquivo", "source_row": "Linha no arquivo",
          "date": "Data", "type": "Tipo de operação", "tipo": "Tipo da ocorrência", "name": "Nome", "merchant_name": "Nome informado", "ec": "EC Orbe", "cnpj": "CNPJ",
          "gross": "Valor bruto (R$)", "reported_fee": "Taxa reportada (R$)", "net": "Valor líquido (R$)", "applied_rate_pct": "Taxa aplicada (%)",
          "valor_brl": "Valor exposto (R$)", "valor": "Valor da evidência (R$)", "amount": "Valor bancário (R$)", "spread_brl": "Spread realizado (R$)",
          "foreign_amount": "Valor em moeda estrangeira", "currency": "Moeda", "ptax_rate": "PTAX (R$/moeda estrangeira)", "fx_rate": "Taxa de câmbio",
          "contracted_date": "Data de contratação", "settlement_date": "Data de liquidação", "original_id": "Operação original", "original_date": "Data da operação original",
          "installments": "Número de parcelas", "modality": "Modalidade", "observation": "Observação", "description": "Descrição", "compliance": "Status informado",
          "dataset": "Origem estruturada", "counterparty": "Contraparte", "evidence_role": "Papel na evidência", "bank": "Banco",
          "motivo": "Descrição da ocorrência", "rule": "Regra utilizada", "regra": "Regra utilizada", "formula": "Fórmula de cálculo", "contract": "Referência contratual",
          "product": "Produto", "rate_pct": "Taxa contratada (%)", "start": "Início da vigência", "end": "Fim da vigência", "active": "Cadastro ativo", "confirmed": "Identidade confirmada"}


def _table(rows):
    """Vertical cards remain readable on screen and paper, even for wide inputs."""
    if not rows: return "<p>Nenhuma linha disponível nesta seção.</p>"
    priority = ("id_saida", "id", "type", "tipo", "date", "contracted_date", "gross", "applied_rate_pct", "reported_fee", "net", "spread_brl", "valor_brl", "amount", "motivo", "source_file", "source_ref", "physical_row")
    def cell(value):
        if isinstance(value, bool): return "Sim" if value else "Não"
        return html.escape(canonical(value) if isinstance(value, (dict, list)) else str(value if value is not None else ""))
    blocks = []
    for index, row in enumerate(rows, 1):
        keys = [key for key in priority if key in row] + sorted(set(row) - set(priority))
        title = row.get("id") or row.get("ref_origem") or row.get("source_ref") or row.get("id_saida") or f"Referência {index}"
        fields = "".join("<div class='field'><dt>" + html.escape(LABELS.get(key, key.replace("_", " ").capitalize())) + "</dt><dd>" + cell(row[key]) + "</dd></div>" for key in keys)
        blocks.append("<article class='evidence-card'><h3>" + cell(title) + "</h3><dl>" + fields + "</dl></article>")
    return "".join(blocks)


def attachments_for(evidence):
    issue = evidence["issue"]
    content = ("<!doctype html><html lang='pt-BR'><meta charset='utf-8'><title>Evidências Tarvo</title>"
               "<style>body{font:15px/1.5 system-ui;margin:32px auto;padding:0 24px;max-width:1100px;color:#18232c;background:#f8fafb}h1,h2{color:#183f48}h2{margin-top:36px}h3{margin:0 0 12px;font-size:16px;color:#183f48}p{max-width:950px}.evidence-card{background:white;border:1px solid #ccd5dd;border-radius:10px;padding:18px;margin:14px 0;break-inside:avoid}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 24px;margin:0}dt{font-size:12px;font-weight:650;color:#536771}dd{margin:3px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}.field{min-width:0}@media(max-width:650px){dl{grid-template-columns:1fr}body{margin:16px auto;padding:0 12px}}@media print{body{background:white;margin:0;font-size:11px}.evidence-card{padding:12px}h2{break-after:avoid}}</style>"
               "<h1>Tarvo · Evidências da pendência</h1><p>Competência: " + html.escape(evidence["period"]) + " · Contraparte: " + html.escape(evidence.get("counterparty") or "a revisar") + "</p>"
               "<h2>Ocorrência</h2>" + _table([{k: issue.get(k, "") for k in ("id_saida", "tipo", "ref_origem", "valor_brl", "motivo", "rule")}])
               + "<p>O valor exposto é o informado para esta ocorrência; não representa automaticamente cobrança, crédito recebido ou soma de outras pendências.</p>"
               + "<h2>Linhas de origem relacionadas</h2>" + _table(evidence["rows"])
               + "<h2>Identificação e referências contratuais</h2>" + _table(evidence["merchants"]) + _table(evidence["contracts"])
               + "<h2>Regra e cálculo</h2>" + _table(evidence["calculation"])
               + "<h2>Rastreabilidade</h2>" + _table(evidence["trace"])
               + "<p>Hash das evidências: " + evidence["evidence_hash"] + "</p></html>").encode("utf-8")
    attachments = [{"name": "evidencias.html", "content_type": "text/html", "data": content}]
    if evidence["rows"]:
        stream = io.StringIO(newline="")
        columns = sorted(set().union(*(r.keys() for r in evidence["rows"])))
        writer = csv.DictWriter(stream, fieldnames=columns, delimiter=";", lineterminator="\n")
        writer.writeheader()
        for row in evidence["rows"]:
            # CSV is a human evidence file, not an executable spreadsheet.
            values = {k: canonical(v) if isinstance(v, (dict, list)) else str(v if v is not None else "") for k, v in row.items()}
            writer.writerow({k: "'" + v if v.lstrip().startswith(("=", "+", "@")) else v for k, v in values.items()})
        attachments.append({"name": "operacoes_relacionadas.csv", "content_type": "text/csv", "data": stream.getvalue().encode("utf-8-sig")})
    for item in attachments: item.update(size=len(item["data"]), sha256=hashlib.sha256(item["data"]).hexdigest())
    return attachments


def template(evidence):
    issue = evidence["issue"]
    party = {"orbe": "Orbe", "ponte": "Ponte Câmbio"}.get(evidence.get("counterparty"), "contraparte a revisar")
    kind = issue.get("tipo", "PENDENCIA")
    confirmed = kind == "DIVERGENCIA_TAXA"
    description = "Divergência identificada" if confirmed else "Solicitação de esclarecimento"
    subject = f"Tarvo | {evidence['period']} | {description} | {issue.get('ref_origem', issue['id_saida'])}"
    references = list(dict.fromkeys(_ref(r) for r in evidence["rows"] if r.get("evidence_role") == "ocorrencia"))
    lines = [f"Olá, equipe {party}.", "", f"Durante a conferência da competência {evidence['period']}, registramos a seguinte ocorrência:",
             issue.get("motivo", "Descrição indisponível; revisar antes do envio."), "", f"Identificador da pendência: {issue['id_saida']}",
             f"Tipo: {kind}", f"Valor exposto na pendência (R$): {issue.get('valor_brl', 'não informado')}",
             "Operações relacionadas: " + (", ".join(references[:10]) + (f" e outras {len(references) - 10}; lista completa nos anexos." if len(references) > 10 else "") if references else "origem a confirmar"), ""]
    if confirmed: lines.append("Solicitamos a conferência da taxa aplicada em relação à referência contratual indicada e o esclarecimento ou correção da divergência.")
    elif kind in {"DUPLICIDADE", "DUPLICIDADE_CONFLITANTE"}: lines.append("Solicitamos a confirmação das linhas repetidas e, se necessário, o relatório corrigido, preservando o identificador da operação.")
    elif kind == "CONFERIR_REPASSE_PONTE": lines.append("Solicitamos o demonstrativo do repasse e a confirmação do valor e da data efetivamente creditados. O valor acima corresponde à base faturada a conferir, não a uma TED já confirmada.")
    elif kind == "SPREAD_NEGATIVO": lines.append("Solicitamos esclarecimento da operação com spread negativo e da taxa utilizada, com o demonstrativo correspondente.")
    else: lines.append("Solicitamos esclarecimento ou documentação que permita confirmar os dados e concluir a análise. Informações ainda não confirmadas permanecem em revisão.")
    lines += ["", "Os anexos apresentam as linhas relacionadas, suas fontes e as referências de cálculo disponíveis. Não estabelecemos prazo de resposta neste pedido.", "", "Obrigado,", "Financeiro Tarvo"]
    return subject, "\n".join(lines)
