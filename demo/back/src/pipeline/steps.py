"""Ten deterministic pipeline steps. Human decisions never mutate prior outputs."""
from __future__ import annotations

import copy
import csv
import hashlib
import io
import json
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Callable

from ..engine import Closing, dec, money, rounded, uid
from ..importer import load_data, cnpj_text
from .datasets import dumps
from .registry import CONFIG, catalog, effective_params


@dataclass
class StepResult:
    datasets: dict[str, list[dict]] = field(default_factory=dict)
    exceptions: list[dict] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)
    logs: list[str] = field(default_factory=list)


@dataclass
class Step:
    type: str
    title: str
    description: str
    inputs: list[str]
    outputs: list[str]
    params_schema: dict
    version: str
    handler: Callable

    def run(self, ctx, params):
        return self.handler(ctx, params)


def _progress(ctx, done, total):
    callback = ctx.get("progress")
    if callback: callback(done, total)


def _exception(kind, row, description, amount="0.00", blocking=True, **extra):
    ref = row.get("source_ref") or row.get("ref_origem") or row.get("id") or "configuração"
    origins = [{"arquivo": row.get("source_file", ""), "ref": ref, "linha": row.get("physical_row", "")}]
    return {"id": uid("EXC", kind, ref, row.get("source_file", "")), "step_id": "", "tipo": kind,
            "severidade": "bloqueante" if blocking else "alerta", "descricao": description,
            "origens": origins, "impacto_rs": money(amount), "ref_origem": ref,
            "source_fingerprint": hashlib.sha256(dumps(row).encode()).hexdigest(), **extra}


def _from_issue(issue):
    return {**copy.deepcopy(issue), "id": issue["id_saida"], "step_id": "", "tipo": issue["tipo"],
            "severidade": "bloqueante" if issue.get("severity") == "bloqueante" else "alerta",
            "descricao": issue["motivo"], "origens": copy.deepcopy(issue.get("evidence", [])), "impacto_rs": issue["valor_brl"]}


def _annotate(rows, exceptions):
    index = defaultdict(set)
    for exc in exceptions:
        index[exc.get("ref_origem", "")].add(exc["id"])
        for origin in exc.get("origens", []):
            index[origin.get("ref", "")].add(exc["id"])
    result = []
    for row in rows:
        row = copy.deepcopy(row)
        refs = {str(row.get(k, "")) for k in ("id", "source_ref", "ref_origem", "id_saida")}
        row["__exception_ids"] = sorted(set(row.get("__exception_ids", [])) | set().union(*(index[ref] for ref in refs)))
        result.append(row)
    return result


def _inputs(ctx):
    datasets = ctx.get("datasets", {})
    mapping = {"checkout": "raw_orbe", "rates": "raw_rates", "merchants": "raw_merchants", "bank": "raw_bank",
               "accounts": "accounts", "sources": "sources", "remittances": "raw_remittances", "import_warnings": "import_warnings"}
    data = {name: copy.deepcopy(datasets.get(source, [])) for name, source in mapping.items()}
    # Upstream normalization/resolution must feed the calculation, not just its preview.
    upstream = datasets.get("orbe_resolvido", datasets.get("orbe_normalizado", datasets.get("raw_orbe", [])))
    source_fields = ("id", "date", "ec", "name", "type", "modality", "installments", "brand", "gross", "applied_rate_pct",
                     "reported_fee", "net", "original_id", "original_date", "source_file", "source_ref", "physical_row")
    data["checkout"] = [{key: row.get(key) for key in source_fields} for row in upstream]
    data["bank_balances"] = {r["bank"]: {k: v for k, v in r.items() if k != "bank"} for r in datasets.get("bank_balances", [])}
    return data


def _computed(ctx, tolerance=None):
    scratch = ctx.setdefault("scratch", {})
    if tolerance is not None: scratch["remittance_tolerance_pp"] = str(tolerance)
    data = _inputs(ctx)
    params = {**ctx.get("references", {}).get("parameters", {}), "period": ctx["period"], "remittance_tolerance_pp": scratch.get("remittance_tolerance_pp", "0.002")}
    resolved_aliases = [(r.get("ec"), r.get("cnpj")) for r in ctx.get("datasets", {}).get("orbe_resolvido", [])
                        if r.get("match_confirmed") and r.get("match_method") == "CNPJ"]
    key = hashlib.sha256(dumps([data, params, sorted(set(resolved_aliases))]).encode()).hexdigest()
    if scratch.get("calculation_key") != key:
        closing = Closing(data, params)
        for ec, cnpj in resolved_aliases:
            choices = closing.by_cnpj.get(cnpj, [])
            if not closing.by_ec.get(ec) and len(choices) == 1 and not choices[0].get("candidate") and choices[0].get("active", True):
                closing.by_ec[ec] = choices
        scratch["calculation"] = closing.run()
        scratch["calculation_key"] = key
    return scratch["calculation"]


def _contract_entries(result, business):
    commissions = {r["id_saida"]: r for r in result["comissoes"] if r["linha_negocio"] == business}
    rows = []
    for detail in result["details"]:
        if detail["id_saida"] not in commissions: continue
        commission = commissions[detail["id_saida"]]
        original = detail.get("entrada", {})
        contract = detail.get("contract", {})
        rows.append({**copy.deepcopy(original), "cnpj": commission["cnpj"], "canonical_name": commission["lojista"],
                     "comissao_brl": detail["valor"], "taxa_contratada_pct": contract.get("rate_pct", ""),
                     "contract_id": contract.get("id", ""), "contract_start": contract.get("start", ""), "contract_end": contract.get("end", ""),
                     "product": contract.get("product", ""), "formula": detail["formula"], "rule": detail["regra"], "calculated": True})
    return rows


def _ler_arquivos(ctx, params):
    data = load_data(ctx["source_dir"])
    for key in ("merchants", "rates"):
        if key in ctx.get("references", {}): data[key] = copy.deepcopy(ctx["references"][key])
    hard = [w for w in data["import_warnings"] if w["type"] in {"ARQUIVO_AUSENTE", "ARQUIVO_AMBIGUO", "ANEXO_AMBIGUO", "ABA_AUSENTE"}]
    if hard: raise ValueError("Importação incompleta: " + "; ".join(w["message"] for w in hard))
    mapping = {"checkout": "raw_orbe", "rates": "raw_rates", "merchants": "raw_merchants", "bank": "raw_bank",
               "accounts": "accounts", "sources": "sources", "remittances": "raw_remittances", "import_warnings": "import_warnings"}
    datasets = {target: copy.deepcopy(data.get(source, [])) for source, target in mapping.items()}
    for rate in datasets["raw_rates"]:
        rate["rate_pct"] = format(dec(rate["rate_pct"]).quantize(Decimal("0.0001")), "f")
    audit_sources = []
    for source in datasets["sources"]:
        full_path = source.pop("path", None)
        source["size"] = Path(full_path).stat().st_size if full_path else None
        source["rows_read"] = source["rows"]
        source["rows_discarded"] = sum(w.get("source_file") == source["name"] for w in data["import_warnings"] if w["type"] == "LINHA_INVALIDA")
        audit_sources.append({**source, "path": full_path})
    ctx.setdefault("scratch", {})["input_audit"] = audit_sources
    datasets["bank_balances"] = [{"bank": bank, **balance} for bank, balance in sorted(data.get("bank_balances", {}).items())]
    exceptions = [_exception(w["type"], w, w["message"]) for w in data["import_warnings"]]
    _progress(ctx, 6, 6)
    return StepResult(datasets, exceptions, {"rows_in": sum(s["rows"] for s in datasets["sources"] if not s.get("embedded")), "rows_out": len(datasets["raw_orbe"]) + len(datasets["raw_remittances"]) + len(datasets["raw_bank"]), "files": 6},
                      ["Seis arquivos lidos sem modificar originais; anexo XLSX extraído em memória.", "Datasets não carregam caminhos absolutos de snapshots de execução."])


def _normalizar_orbe(ctx, params):
    rows, exceptions = [], []
    source = ctx["datasets"]["raw_orbe"]
    for index, source_row in enumerate(source):
        row = copy.deepcopy(source_row)
        try:
            for required in ("id", "date", "ec", "type", "gross", "applied_rate_pct", "reported_fee", "net"):
                if row.get(required) in (None, ""): raise ValueError(f"Campo obrigatório ausente: {required}")
            date.fromisoformat(row["date"])
            for field_name in ("gross", "reported_fee", "net"): row[field_name] = format(dec(row[field_name]), "f")
            row["applied_rate_pct"] = format(dec(row["applied_rate_pct"]), "f")
            if row["type"] in ("ANTECIPACAO", "REVERSAO ANTECIPACAO"): row["faixa_parcelas"] = "ANTECIPACAO"
            elif row["modality"] == "CREDITO PARCELADO":
                n = int(row.get("installments") or 0)
                row["faixa_parcelas"] = "CREDITO_A_VISTA" if n == 1 else "CREDITO_2_6" if 2 <= n <= 6 else "CREDITO_7_12" if 7 <= n <= 12 else "INVALIDA"
                if row["faixa_parcelas"] == "INVALIDA": raise ValueError("Parcelas fora da faixa contratada.")
                if n == 1: row["modality"] = "CREDITO A VISTA"
            else: row["faixa_parcelas"] = {"CREDITO A VISTA": "CREDITO_A_VISTA", "PIX": "PIX", "DEBITO": "DEBITO"}.get(row["modality"], "INVALIDA")
            row["normalization_valid"] = True
        except (ValueError, KeyError, InvalidOperation) as exc:
            row["normalization_valid"] = False
            exceptions.append(_exception("ORBE_CAMPOS_INVALIDOS", row, str(exc)))
        rows.append(row)
        if index % 200 == 0: _progress(ctx, index + 1, len(source))
    _progress(ctx, len(source), len(source))
    return StepResult({"orbe_normalizado": _annotate(rows, exceptions)}, exceptions, {"rows_in": len(source), "rows_out": len(rows)}, ["Valores monetários continuam strings decimais exatas; identificação original preservada."])


def _name_key(value):
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(c for c in text if not unicodedata.combining(c)).upper()
    return " ".join(re.sub(r"\b(LTDA|LIMITADA)\b|[^A-Z0-9 ]", " ", text).split())


def _resolver(ctx, params):
    source = ctx["datasets"]["orbe_normalizado"]
    merchants = ctx["datasets"]["raw_merchants"]
    by_ec, by_cnpj, by_name = defaultdict(list), defaultdict(list), defaultdict(list)
    for merchant in merchants:
        if merchant.get("ec"): by_ec[merchant["ec"]].append(merchant)
        by_cnpj[merchant["cnpj"]].append(merchant)
        by_name[_name_key(merchant["name"])].append(merchant)
    rows, exceptions = [], []
    result = _computed(ctx)
    merchant_kinds = {"CADASTRO_AUSENTE", "CADASTRO_AMBIGUO", "CNPJ_INVALIDO", "CADASTRO_NAO_CONFIRMADO"}
    exceptions.extend(_from_issue(i) for i in result["pendencias"] if i["tipo"] in merchant_kinds and not str(i["ref_origem"]).startswith("PC-"))
    for row in source:
        row = copy.deepcopy(row)
        choices = by_ec.get(row.get("ec"), [])
        method = "EC" if choices else ""
        if not choices and params["fallback"] == "cnpj" and row.get("cnpj"):
            choices = by_cnpj.get(cnpj_text(row["cnpj"]), [])
            method = "CNPJ" if choices else ""
        if len(choices) == 1:
            merchant = choices[0]
            row.update(cnpj=merchant["cnpj"], canonical_name=merchant["name"], match_method=method,
                       match_confirmed=bool(merchant.get("active", True) and not merchant.get("candidate")), merchant_source_ref=merchant.get("source_ref", ""))
        else:
            row.update(cnpj="", canonical_name="", match_method="", match_confirmed=False)
            candidates = by_name.get(_name_key(row.get("name")), []) if params["sugerir_nome"] else []
            row["candidate_cnpjs"] = [m["cnpj"] for m in candidates]
            if candidates:
                exceptions.append(_exception("VINCULO_FRACO", row, "Nome normalizado sugere candidato, mas não autoriza vínculo ou faturamento; confirme EC/CNPJ.", candidates=row["candidate_cnpjs"]))
        rows.append(row)
    accepted_by_cnpj = {r["id"] for r in rows if r.get("match_confirmed") and r.get("match_method") == "CNPJ"}
    exceptions = [e for e in exceptions if not (e.get("ref_origem") in accepted_by_cnpj and e["tipo"] == "CADASTRO_AUSENTE")]
    return StepResult({"orbe_resolvido": _annotate(rows, exceptions)}, exceptions,
                      {"rows_in": len(source), "rows_out": len(rows), "matched": sum(r["match_confirmed"] for r in rows)}, ["Sem casamento aproximado automático; as três correspondências EC confirmadas no Slack são preservadas."])


def _mdr(ctx, params):
    result = _computed(ctx)
    calculated = {r["id"]: r for r in _contract_entries(result, "CHECKOUT")}
    source = ctx["datasets"]["orbe_resolvido"]
    refs = {r["id"] for r in source if r["type"] in ("VENDA", "ANTECIPACAO") and r["date"][:7] == ctx["period"]}
    owned = {"DIVERGENCIA_TAXA", "TAXA_AUSENTE", "TAXA_SOBREPOSTA", "TAXA_INVALIDA", "CHECKOUT_INVALIDO", "VALOR_INVALIDO"}
    exceptions = [_from_issue(i) for i in result["pendencias"] if i["ref_origem"] in refs and i["tipo"] in owned]
    divergence = {r["ref_origem"]: r for r in result["divergencias"] if r["linha_negocio"] == "CHECKOUT"}
    rows = []
    for original in source:
        row = copy.deepcopy(original)
        if row["id"] in refs:
            row.update(calculated.get(row["id"], {"calculated": False, "comissao_brl": None}))
            if row["id"] in divergence:
                difference = divergence[row["id"]]
                row.update(diferenca_pp=format(dec(difference["taxa_aplicada_pct"]) - dec(difference["taxa_contratada_pct"]), "f"), impacto_rs=difference["diferenca_brl"])
        rows.append(row)
    return StepResult({"mdr_conferido": _annotate(rows, exceptions)}, exceptions, {"rows_in": len(source), "rows_out": len(rows), "vendas_antecipacoes": len(refs)},
                      ["Contrato por produto e data. MDR Casa zero mantém divergências de devolução; truncamento isolado não gera alerta."])


def _estornos(ctx, params):
    result = _computed(ctx)
    calculated = {r["id"]: r for r in _contract_entries(result, "CHECKOUT")}
    source = ctx["datasets"]["mdr_conferido"]
    index = {r["id"]: r for r in ctx["datasets"]["raw_orbe"]}
    reverse_refs = {r["id"] for r in source if r["type"] in ("ESTORNO", "REVERSAO ANTECIPACAO") and r["date"][:7] == ctx["period"]}
    exceptions = [_from_issue(i) for i in result["pendencias"] if (i["ref_origem"] in reverse_refs and i["tipo"] not in {"CADASTRO_NAO_CONFIRMADO", "CADASTRO_AUSENTE"}) or i["tipo"] in {"COMISSAO_NEGATIVA", "COMPETENCIA_SEM_MOVIMENTOS"}]
    rows = []
    for original in source:
        row = copy.deepcopy(original)
        row.update(calculated.get(row["id"], {"calculated": False, "comissao_brl": None}))
        if row["id"] in reverse_refs:
            row["original_present"] = row.get("original_id") in index
            row["link_status"] = "ORIGINAL_PRESENTE" if row["original_present"] else "HISTORICO_DATA_ORIGINAL" if row.get("original_date", "")[:7] < ctx["period"] and row.get("calculated") else "PENDENTE"
        rows.append(row)
    return StepResult({"checkout_calculado": _annotate(rows, exceptions)}, exceptions,
                      {"rows_in": len(source), "rows_out": len(rows), "checkout_brl": result["summary"]["checkout_brl"]}, ["Estornos usam data original. Ausência de venda de agosto não impede cálculo quando a fonte contém data, EC, modalidade e bruto."])


def _bancos(ctx, params):
    result = _computed(ctx)
    refs = {r["ref_origem"] for r in result["lancamentos"]}
    exceptions = [_from_issue(i) for i in result["pendencias"] if i["ref_origem"] in refs]
    balances = []
    for raw in ctx["datasets"].get("bank_balances", []):
        movements = [r for r in result["lancamentos"] if r["banco"] == raw["bank"]]
        total = sum((dec(r["valor"]) for r in movements), Decimal(0))
        closing = dec(raw["closing"]) if raw.get("closing") else None
        opening = dec(raw["opening"]) if raw.get("opening") else None
        difference = closing - opening - total if closing is not None and opening is not None else None
        balances.append({"bank": raw["bank"], "opening": money(opening) if opening is not None else None,
                         "movement_brl": money(total), "closing": money(closing) if closing is not None else None,
                         "difference_brl": money(difference) if difference is not None else None,
                         "opening_inferred_brl": money(closing - total) if opening is None and closing is not None else None,
                         "status": "CONFERIDO" if difference == 0 else "ABERTURA_NAO_FORNECIDA" if opening is None else "DIVERGENTE"})
        if difference is not None and difference != 0:
            exceptions.append(_exception("SALDO_DIVERGENTE", {"id": raw["bank"], "source_file": "Extrato bancário"}, "Saldo inicial mais movimentos difere do saldo final.", difference))
    return StepResult({"bancos_classificados": _annotate(result["lancamentos"], exceptions), "saldos_conferidos": balances}, exceptions,
                      {"rows_in": len(ctx["datasets"]["raw_bank"]), "rows_out": len(result["lancamentos"]), "conciliação_parcelas_orbe": "NAO_SUPORTADA_PELAS_FONTES"},
                      ["TED Orbe: classificação como baixa de recebível. Sem agenda de liquidação, não há casamento inventado com vendas/parcelas.", "Meridiano não fornece saldo inicial explícito: saldo inicial inferido é identificado como inferência."])


def _cambio(ctx, params):
    result = _computed(ctx, params["tolerancia_pp"])
    calculated = {r["id"]: r for r in _contract_entries(result, "REMESSA")}
    source = ctx["datasets"]["raw_remittances"]
    refs = {r["id"] for r in source}
    exceptions = [_from_issue(i) for i in result["pendencias"] if i["ref_origem"] in refs]
    rows, seen = [], set()
    for original in source:
        if original["contracted_date"][:7] != ctx["period"]: continue
        row = copy.deepcopy(original)
        duplicate = row["id"] in seen
        row.update(calculated.get(row["id"], {"calculated": False, "comissao_brl": None}))
        row["counted"] = not duplicate and row.get("calculated", False)
        row["duplicated_id"] = duplicate
        if duplicate: row["comissao_brl"] = "0.00"
        row["compliance_aceito"] = row["compliance"] in ("APROVADO", "APROVADO C/ RESSALVA")
        seen.add(row["id"])
        rows.append(row)
    return StepResult({"cambio_calculado": _annotate(rows, exceptions)}, exceptions,
                      {"rows_in": len(source), "rows_out": len(rows), "unique_operations": len(seen), "remessa_brl": result["summary"]["remessa_brl"]},
                      ["50% do realizado positivo por operação, HALF_UP; duplicata conta uma vez, negativos fora da comissão.", "Spread padrão 1,5% e aprovação com ressalva confirmados no Slack. Tolerância de cotação em pontos percentuais."])


def _post_pair(rows, event, source, amount, debit, credit, description, exceptions, cnpj=""):
    amount = dec(amount)
    if amount == 0: return
    ref = source.get("source_ref") or source.get("ref_origem") or source.get("id")
    entry_id = uid("LCT", event, source.get("bank", source.get("banco", "")), ref)
    if amount < 0: debit, credit, amount = credit, debit, -amount
    accounts = [("D", debit), ("C", credit)]
    ids = sorted({exc["id"] for exc in exceptions if exc.get("ref_origem") == ref or any(o.get("ref") == ref for o in exc.get("origens", []))})
    for side, account in accounts:
        rows.append({"id": entry_id + "-" + side, "entry_id": entry_id, "data": source.get("date", source.get("data", source.get("contracted_date", ""))),
                     "conta_codigo": account, "natureza": side, "debito": money(amount if side == "D" else 0), "credito": money(amount if side == "C" else 0),
                     "valor": money(amount), "historico": description, "ref_origem": ref, "arquivo_origem": source.get("source_file", source.get("arquivo_origem", "")),
                     "event_type": event, "cnpj": cnpj, "__exception_ids": ids,
                     "adjustable_account": (side == "C" if amount >= 0 else side == "D") if event != "BANCO" else False})


def validate_ledger(rows, accounts):
    allowed = {a["code"] for a in accounts if a.get("postable")}
    errors, groups = [], defaultdict(list)
    for row in rows:
        groups[row.get("entry_id")].append(row)
        if row.get("conta_codigo") not in allowed: errors.append(f"Conta inexistente ou sintética: {row.get('conta_codigo')}")
        try:
            debit, credit = dec(row["debito"]), dec(row["credito"])
            if debit < 0 or credit < 0 or debit * credit != 0 or debit + credit <= 0: errors.append(f"Débito/crédito inválido: {row.get('id')}")
            if debit != rounded(debit) or credit != rounded(credit): errors.append(f"Precisão monetária inválida: {row.get('id')}")
        except (InvalidOperation, ValueError, KeyError): errors.append(f"Valor inválido: {row.get('id')}")
    for entry_id, group in groups.items():
        try:
            if len(group) != 2 or sum((dec(r["debito"]) - dec(r["credito"]) for r in group), Decimal(0)) != 0:
                errors.append(f"Partida desbalanceada: {entry_id}")
        except (InvalidOperation, ValueError, KeyError): pass
    return errors


def _gerar(ctx, params):
    result = _computed(ctx)
    mapping = json.loads((CONFIG / "mapa_contabil.json").read_text(encoding="utf-8"))
    accounts = ctx["datasets"]["accounts"]
    allowed = {a["code"] for a in accounts if a.get("postable")}
    exceptions = []
    all_exceptions = list(ctx.get("exceptions", []))
    known = {e["id"] for e in all_exceptions}
    missing = [_from_issue(i) for i in result["pendencias"] if i["id_saida"] not in known]
    exceptions.extend(missing)
    all_exceptions.extend(missing)
    ledger = []
    bank_sources = {(r["bank"], r["ref_origem"]): r for r in ctx["datasets"]["raw_bank"]}
    for item in result["lancamentos"]:
        source = bank_sources[(item["banco"], item["ref_origem"])]
        amount = dec(item["valor"])
        bank_account = mapping["bank_accounts"].get(item["banco"], "")
        counterpart = item["conta_codigo"]
        if bank_account not in allowed or counterpart not in allowed:
            exceptions.append(_exception("CONTA_NAO_ANALITICA", source, "Lançamento bancário retido porque falta conta analítica válida.", amount))
            continue
        start = len(ledger)
        _post_pair(ledger, "BANCO", source, amount, bank_account, counterpart, item["regra"], all_exceptions)
        for row in ledger[start:]: row["adjustable_account"] = row["conta_codigo"] == counterpart
    for business in ("CHECKOUT", "REMESSA"):
        for source in _contract_entries(result, business):
            event = "REMESSA" if business == "REMESSA" else "ANTECIPACAO" if source["product"] == "ANTECIPACAO" else "MDR"
            rule = mapping["events"][event]
            if rule["debit"] not in allowed or rule["credit"] not in allowed:
                exceptions.append(_exception("CONTA_NAO_ANALITICA", source, "Comissão retida no lote: conta do mapa inexistente ou sintética.", source["comissao_brl"]))
                continue
            start = len(ledger)
            _post_pair(ledger, event, source, source["comissao_brl"], rule["debit"], rule["credit"], rule["description"], all_exceptions, source["cnpj"])
            for row in ledger[start:]: row["adjustable_account"] = row["conta_codigo"] == rule["credit"]
    mapping_exception = _exception("MAPA_CONTABIL_A_CONFIRMAR", {"id": "mapa_contabil@1", "source_file": "src/config/mapa_contabil.json"},
                                   "Revisar mapa contábil proposto antes de exportar: contrapartidas bancárias confirmadas e apropriação das comissões por contas de receita/recebíveis. Não inclui tributos sobre NF.")
    exceptions.append(mapping_exception)
    errors = validate_ledger(ledger, accounts)
    if errors: exceptions.append(_exception("LOTE_DESBALANCEADO", {"id": "lote"}, "; ".join(errors)))
    datasets = {"lancamentos": ledger, "comissoes": result["comissoes"], "divergencias": result["divergencias"], "notas": result["notas"],
                "pendencias": result["pendencias"], "rastro": result["rastro"], "detalhes_calculo": result["details"]}
    total = sum((dec(r["debito"]) for r in ledger), Decimal(0))
    return StepResult(datasets, exceptions, {"rows_in": len(result["lancamentos"]) + len(result["comissoes"]), "rows_out": len(ledger),
                     "debit_total": money(total), "credit_total": money(sum((dec(r["credito"]) for r in ledger), Decimal(0))), "balanced": not errors},
                     ["Duas linhas por partida, com D/C e contas analíticas. Nenhum lançamento de tributos inventado.", "Mapa proposto exige aprovação humana explícita; saídas anteriores não são alteradas."])


def _approval(ctx, params):
    return StepResult({"aprovacao_pendente": [{"period": ctx["period"], "requires_human_approval": True,
                       "ledger_hash": hashlib.sha256(dumps(ctx["datasets"]["lancamentos"]).encode()).hexdigest()}]}, [],
                      {"rows_in": len(ctx["datasets"]["lancamentos"]), "rows_out": 1, "requires_approval": True}, ["Gate obrigatório: execução aguarda decisão registrada pelo serviço."])


def _adjusted_ledger(ctx, adjustments):
    rows = copy.deepcopy(ctx["datasets"]["lancamentos"])
    exceptions = {e["id"]: e for e in ctx.get("exceptions", [])}
    allowed = {a["code"] for a in ctx["datasets"]["accounts"] if a.get("postable")}
    applied = []
    for adjustment in adjustments:
        action = adjustment.get("acao", adjustment.get("action"))
        if action in {"aceitar", "accept", "confirm"}: continue
        if action not in {"ajustar", "adjust", "excluir", "excluir_do_lote", "exclude"}: raise ValueError("Ação de ajuste desconhecida.")
        if not str(adjustment.get("justificativa", adjustment.get("note", ""))).strip(): raise ValueError("Ajuste exige justificativa.")
        exception = exceptions.get(adjustment.get("exception_id", adjustment.get("id")))
        if not exception: raise ValueError("Ajuste sem exceção identificável no run.")
        targets = {r["entry_id"] for r in rows if exception["id"] in r.get("__exception_ids", [])}
        if adjustment.get("entry_id"):
            if adjustment["entry_id"] not in targets: raise ValueError("Partida escolhida não pertence à exceção.")
            targets = {adjustment["entry_id"]}
        excluding = action in {"excluir", "excluir_do_lote", "exclude"}
        if not targets:
            if excluding:
                applied.append({**adjustment, "target_entry_ids": [], "already_excluded": True})
                continue
            raise ValueError("Exceção sem partida original: não é permitido criar receita por ajuste. Corrija a fonte/cadastro e execute novo run.")
        if not excluding and len(targets) != 1: raise ValueError("Ajuste monetário/contábil possui múltiplas partidas; informe entry_id explícito.")
        if excluding:
            rows = [r for r in rows if r["entry_id"] not in targets]
        else:
            value = adjustment.get("valor")
            account = adjustment.get("conta", adjustment.get("account_code"))
            if value is None and not account: raise ValueError("Ajuste deve informar valor ou conta.")
            if account and account not in allowed: raise ValueError("Conta ajustada deve ser analítica e existir no plano.")
            removed = False
            if value is not None:
                number = dec(value)
                if number < 0 or number != rounded(number): raise ValueError("Valor ajustado deve ser finito, não negativo e ter no máximo duas casas.")
                if number == 0:
                    rows = [r for r in rows if r["entry_id"] not in targets]
                    removed = True
                else:
                    for row in rows:
                        if row["entry_id"] in targets:
                            row.update(valor=money(number), debito=money(number if row["natureza"] == "D" else 0), credito=money(number if row["natureza"] == "C" else 0))
            if account and not removed:
                editable = [r for r in rows if r["entry_id"] in targets and r.get("adjustable_account")]
                if len(editable) != 1: raise ValueError("Contrapartida do ajuste não é única.")
                editable[0]["conta_codigo"] = account
        applied.append({**adjustment, "target_entry_ids": sorted(targets)})
    errors = validate_ledger(rows, ctx["datasets"]["accounts"])
    if errors: raise ValueError("Exportação bloqueada: " + "; ".join(errors))
    return rows, applied


def _csv_bytes(rows, columns):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=columns, delimiter=";", lineterminator="\n", extrasaction="ignore")
    writer.writeheader()
    for row in rows: writer.writerow({key: dumps(value) if isinstance(value, (dict, list)) else value for key, value in row.items()})
    return stream.getvalue().encode("utf-8")


def export_artifacts(ctx, adjustments, destination):
    if ctx.get("approved") is not True: raise PermissionError("Aprovação humana registrada é obrigatória antes de exportar.")
    rows, applied = _adjusted_ledger(ctx, adjustments or [])
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    columns = ["id", "entry_id", "data", "conta_codigo", "natureza", "debito", "credito", "valor", "historico", "ref_origem", "arquivo_origem", "event_type", "cnpj", "__exception_ids"]
    exceptions = sorted(ctx.get("exceptions", []), key=lambda r: r["id"])
    normalized_adjustments = [{key: value for key, value in row.items() if key not in {"at", "created_at", "updated_at", "timestamp", "run_id"}} for row in applied]
    payloads = {
        "lancamentos_fenix.csv": _csv_bytes(rows, columns),
        "relatorio_excecoes.csv": _csv_bytes(exceptions, ["id", "step_id", "tipo", "severidade", "descricao", "ref_origem", "impacto_rs", "origens", "status"]),
        "ajustes.csv": _csv_bytes(normalized_adjustments, ["exception_id", "acao", "valor", "conta", "entry_id", "target_entry_ids", "already_excluded", "justificativa", "actor"]),
    }
    manifest = []
    for name, content in payloads.items():
        (destination / name).write_bytes(content)
        manifest.append({"name": name, "path": name, "sha256": hashlib.sha256(content).hexdigest(), "size": len(content), "rows": len(rows) if name == "lancamentos_fenix.csv" else len(exceptions) if name == "relatorio_excecoes.csv" else len(applied)})
    return {"files": manifest, "rows": len(rows), "debit_total": money(sum((dec(r["debito"]) for r in rows), Decimal(0))),
            "credit_total": money(sum((dec(r["credito"]) for r in rows), Decimal(0))), "adjustments_applied": len(applied)}


def _export(ctx, params):
    destination = ctx.get("export_dir") or ctx.get("scratch", {}).get("export_dir")
    if destination is None:
        if not ctx.get("run_dir"): raise ValueError("Diretório de exportação não informado.")
        destination = Path(ctx["run_dir"]) / "export"
    manifest = export_artifacts(ctx, ctx.get("adjustments", []), destination)
    return StepResult({"export_manifest": manifest["files"]}, [], {key: value for key, value in manifest.items() if key != "files"},
                      ["CSV determinístico exportado após aprovação. Auditoria cronológica é adicionada pelo serviço, separada dos hashes de conteúdo financeiro."])


_HANDLERS = {"ler_arquivos": _ler_arquivos, "normalizar_orbe": _normalizar_orbe, "resolver_lojista": _resolver, "conferir_mdr": _mdr,
             "vincular_estornos": _estornos, "conciliar_aurora": _bancos, "processar_cambio": _cambio, "gerar_lancamentos": _gerar,
             "aprovacao": _approval, "exportar_erp": _export}


def execute_step(step_type, ctx, params=None):
    entry = next((s for s in catalog() if s["type"] == step_type), None)
    if entry is None: raise ValueError(f"Passo desconhecido: {step_type}")
    params = effective_params(step_type, params or {})
    missing = [name for name in entry["inputs"] if name not in ctx.get("datasets", {})]
    if missing: raise ValueError("Datasets de entrada ausentes: " + ", ".join(missing))
    step = Step(**{key: entry[key] for key in ("type", "title", "description", "inputs", "outputs", "params_schema", "version")}, handler=_HANDLERS[step_type])
    result = step.run(ctx, params)
    known_ids = {e["id"] for e in ctx.get("exceptions", [])}
    result.exceptions = [exc for exc in result.exceptions if exc["id"] not in known_ids]
    result.metrics.setdefault("exceptions", len(result.exceptions))
    result.logs.insert(0, f"Passo {step_type}, versão {step.version}; execução determinística, sem chamadas de LLM.")
    return result
