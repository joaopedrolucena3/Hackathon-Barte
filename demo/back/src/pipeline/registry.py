"""Versioned deterministic step catalog and structural/parameter validation."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

from jsonschema import Draft202012Validator

CONFIG = Path(__file__).resolve().parents[1] / "config"


def schema(properties=None):
    return {"type": "object", "properties": properties or {}, "additionalProperties": False}


def spec(type_, title, description, inputs, outputs, params=None):
    return {"type": type_, "title": title, "description": description, "inputs": inputs, "outputs": outputs,
            "params_schema": schema(params), "version": "1.0.0", "deterministic": True}


_CATALOG = [
    spec("ler_arquivos", "Ler arquivos", "Importa os seis arquivos originais e o anexo, preservando hashes, linhas e formatos.", [],
         ["raw_orbe", "raw_rates", "raw_merchants", "raw_bank", "accounts", "sources", "raw_remittances", "import_warnings", "bank_balances"]),
    spec("normalizar_orbe", "Normalizar Orbe", "Valida campos, datas, valores exatos e modalidade; conserva a linha de origem.", ["raw_orbe"], ["orbe_normalizado"]),
    spec("resolver_lojista", "Resolver lojista", "Vincula por EC confirmado ou CNPJ exato. Nome apenas sugere candidatos para revisão, sem autorizar faturamento.",
         ["orbe_normalizado", "raw_merchants"], ["orbe_resolvido"],
         {"fallback": {"type": "string", "enum": ["cnpj", "nenhum"], "default": "cnpj"}, "sugerir_nome": {"type": "boolean", "default": True}}),
    spec("conferir_mdr", "Conferir MDR", "Calcula venda e antecipação pela taxa contratada vigente. Taxa zero Casa também gera divergência quando a Orbe cobrou.",
         ["orbe_resolvido", "raw_rates"], ["mdr_conferido"], {"tolerancia_pp": {"type": "number", "const": 0, "default": 0, "description": "A regra confirmada compara taxas exatas; truncamento monetário isolado não é divergência."}}),
    spec("vincular_estornos", "Vincular estornos", "Usa taxa e data originais, inclusive agosto. Referência histórica suficiente não vira falso bloqueio.",
         ["mdr_conferido", "orbe_resolvido"], ["checkout_calculado"]),
    spec("conciliar_aurora", "Conferir bancos", "Classifica contrapartidas e verifica transferências e saldo Aurora. TED Orbe agregada não permite conciliação de parcelas.",
         ["raw_bank", "accounts", "checkout_calculado", "bank_balances"], ["bancos_classificados", "saldos_conferidos"],
         {"janela_dias": {"type": "integer", "const": 0, "default": 0}, "conciliar_parcelas_orbe": {"type": "boolean", "const": False, "default": False}}),
    spec("processar_cambio", "Processar câmbio", "Apura 50% por operação positiva única, pela contratação. Ressalvas de compliance autorizadas não são impedimento.",
         ["raw_remittances", "raw_rates", "raw_merchants", "bancos_classificados"], ["cambio_calculado"],
         {"participacao_spread": {"type": "number", "const": 0.5, "default": 0.5}, "spread_padrao_pct": {"type": "number", "const": 1.5, "default": 1.5},
          "tolerancia_pp": {"type": "number", "minimum": 0, "maximum": 0.05, "default": 0.002}}),
    spec("gerar_lancamentos", "Gerar lançamentos", "Produz partidas dobradas com contas analíticas e conserva a ligação com comissão, extrato e regra.",
         ["checkout_calculado", "cambio_calculado", "bancos_classificados", "accounts"],
         ["lancamentos", "comissoes", "divergencias", "notas", "pendencias", "rastro", "detalhes_calculo"],
         {"mapa": {"type": "string", "const": "mapa_contabil", "default": "mapa_contabil"}, "calcular_tributos": {"type": "boolean", "const": False, "default": False}}),
    spec("aprovacao", "Aprovação humana", "Pausa o lote para decisão registrada. Exceções bloqueantes precisam de encaminhamento antes de aprovar.",
         ["lancamentos", "pendencias"], ["aprovacao_pendente"]),
    spec("exportar_erp", "Exportar para o Fênix", "Aplica ajustes sem reescrever etapas anteriores e exporta somente o lote aprovado.",
         ["aprovacao_pendente", "lancamentos"], ["export_manifest"], {"formato": {"type": "string", "const": "csv_fenix", "default": "csv_fenix"}}),
]


def catalog():
    result = copy.deepcopy(_CATALOG)
    fingerprint = code_fingerprint()
    for entry in result:
        entry["code_sha256"] = fingerprint
        entry["version"] += "+" + fingerprint[:12]
    return result


def code_fingerprint():
    root = Path(__file__).resolve().parents[1]
    names = ["pipeline/registry.py", "pipeline/steps.py", "pipeline/datasets.py", "engine.py", "importer.py", "config/mapa_contabil.json", "config/pipeline_default.json"]
    digest = hashlib.sha256()
    for name in names:
        path = root / name
        if path.exists():
            digest.update(name.encode())
            digest.update(b"\0")
            digest.update(path.read_bytes())
    return digest.hexdigest()


def default_definition():
    return json.loads((CONFIG / "pipeline_default.json").read_text(encoding="utf-8"))


def effective_params(step_type, params):
    try: json.dumps(params, allow_nan=False)
    except (ValueError, TypeError) as exc: raise ValueError("Parâmetros devem ser JSON válido com números finitos.") from exc
    entry = next((x for x in _CATALOG if x["type"] == step_type), None)
    if entry is None:
        raise ValueError(f"Tipo de passo desconhecido: {step_type}")
    errors = list(Draft202012Validator(entry["params_schema"]).iter_errors(params))
    if errors:
        raise ValueError("; ".join(e.message for e in errors))
    return {**{k: v["default"] for k, v in entry["params_schema"]["properties"].items() if "default" in v}, **params}


def validate_definition(definition):
    errors = []
    def error(code, message, step_id=None, path=""):
        errors.append({"code": code, "message": message, "step_id": step_id, "path": path})
    try: json.dumps(definition, allow_nan=False)
    except (ValueError, TypeError):
        error("DEFINITION_JSON", "Definição deve ser JSON válido com números finitos.")
        return errors
    top_schema = {"type": "object", "required": ["id", "version", "steps"], "properties": {
        "id": {"type": "string", "minLength": 1}, "version": {"type": "integer", "minimum": 1},
        "title": {"type": "string"}, "steps": {"type": "array", "minItems": 1, "items": {
            "type": "object", "required": ["id", "type", "params"], "additionalProperties": False,
            "properties": {"id": {"type": "string", "pattern": "^[A-Za-z0-9_-]+$"}, "type": {"type": "string"}, "params": {"type": "object"}}}}}, "additionalProperties": False}
    for issue in Draft202012Validator(top_schema).iter_errors(definition):
        error("DEFINITION_SCHEMA", issue.message, path="/".join(map(str, issue.path)))
    if errors:
        return errors
    entries = {s["type"]: s for s in _CATALOG}
    produced, identifiers, types_seen = set(), set(), set()
    gates, exports = [], []
    for index, step in enumerate(definition["steps"]):
        ident, typ = step["id"], step["type"]
        if ident in identifiers:
            error("DUPLICATE_STEP_ID", "ID de passo repetido.", ident)
        identifiers.add(ident)
        if typ not in entries:
            error("UNKNOWN_STEP", f"Tipo desconhecido: {typ}.", ident)
            continue
        if typ in types_seen:
            error("DUPLICATE_STEP_TYPE", "Um produtor não pode sobrescrever datasets de outro passo do mesmo tipo.", ident)
        types_seen.add(typ)
        entry = entries[typ]
        for issue in Draft202012Validator(entry["params_schema"]).iter_errors(step["params"]):
            error("PARAMS_SCHEMA", issue.message, ident, "/".join(map(str, issue.path)))
        missing = [name for name in entry["inputs"] if name not in produced]
        if missing:
            error("MISSING_DEPENDENCY", "Entradas ainda não produzidas: " + ", ".join(missing), ident)
        produced.update(entry["outputs"])
        if typ == "aprovacao": gates.append(index)
        if typ == "exportar_erp": exports.append(index)
    if len(gates) != 1:
        error("APPROVAL_REQUIRED", "É obrigatório exatamente um passo de aprovação.")
    if len(exports) != 1:
        error("EXPORT_REQUIRED", "É obrigatório exatamente um passo de exportação.")
    if len(gates) == len(exports) == 1:
        if gates[0] != len(definition["steps"]) - 2 or exports[0] != len(definition["steps"]) - 1:
            error("APPROVAL_EXPORT_ORDER", "Aprovação e exportação devem ser os dois últimos passos, nessa ordem; não pode haver cálculo após aprovar.")
    return errors
