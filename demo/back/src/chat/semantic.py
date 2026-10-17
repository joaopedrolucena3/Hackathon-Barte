"""Semantic layer shared by the data grid and the chat: labels, meanings, kinds, control totals
and cross-step invariants. Sums use Decimal in Python, independent of the SQL engine.

`semantica.json` lives outside `src/config` on purpose: editing labels or the glossary must not
change the code snapshot that gates approval of runs already in review.
"""
from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path

from ..pipeline.datasets import column_type

PATH = Path(__file__).with_name("semantica.json")
NUMERIC = {"money", "percent", "decimal", "number", "integer"}


@lru_cache(maxsize=1)
def load():
    return json.loads(PATH.read_text(encoding="utf-8"))


def kind(name, storage_type="", is_json=False):
    """money, percent, decimal, number, integer, boolean, date, json or text."""
    override = load()["tipos_por_coluna"].get(name)
    if override: return override
    if is_json: return "json"
    if storage_type == "bool": return "boolean"
    if storage_type == "int64": return "integer"
    return column_type(name)


def label(dataset, name):
    sem = load()
    return sem["datasets"].get(dataset, {}).get("rotulos", {}).get(name) or sem["rotulos"].get(name) or name.replace("_", " ").capitalize()


def title(dataset):
    return load()["datasets"].get(dataset, {}).get("titulo") or dataset.replace("_", " ").capitalize()


def meaning(dataset, name):
    sem = load()
    return sem["datasets"].get(dataset, {}).get("colunas", {}).get(name) or sem["colunas"].get(name, "")


def describe(dataset, schema):
    """Parquet schema metadata → display columns with meaning for tooltips and prompts. Parquet stores
    columns alphabetically; the reading order (identity, date, merchant, type, amounts) comes from `ordem_colunas`."""
    sem = load()
    hidden, rank = set(sem["ocultas"]), {name: i for i, name in enumerate(sem["ordem_colunas"])}
    ordered = sorted(enumerate(schema), key=lambda item: (rank.get(item[1]["name"], len(rank)), item[0]))
    return [{"name": col["name"], "label": label(dataset, col["name"]), "kind": kind(col["name"], col.get("storage_type", ""), col.get("json", False)),
             "description": meaning(dataset, col["name"]), "hidden": col["name"] in hidden or col["name"].startswith("__")} for _, col in ordered]


def decimal(value):
    if value is None or value == "": return None
    try: number = Decimal(str(value))
    except InvalidOperation as exc: raise ValueError(f"Valor decimal inválido: {value!r}") from exc
    if not number.is_finite(): raise ValueError("Número não finito no dataset.")
    return number


def column_sum(rows, column, minus=None, where=None):
    total = Decimal(0)
    for row in rows:
        if where and any(row.get(key) != value for key, value in where.items()): continue
        value = decimal(row.get(column))
        if value is not None: total += value
        if minus:
            other = decimal(row.get(minus))
            if other is not None: total -= other
    return total


def money(value):
    return format(value.quantize(Decimal("0.01")), "f")


def totals(dataset, columns, rows):
    """Control totals of the step's table: the configured columns, or every money column."""
    configured = load()["datasets"].get(dataset, {}).get("totais_controle")
    names = {c["name"] for c in columns}
    chosen = [name for name in configured if name in names] if configured else [c["name"] for c in columns if c["kind"] == "money"]
    return [{"column": name, "label": label(dataset, name), "value": money(column_sum(rows, name))} for name in chosen]


def invariants(steps, rows_of, only=None):
    """Cross-step checks from semantica.json. `steps`: [{id, number, type, title, metrics, datasets}].
    An invariant is reported only when every side is available in this run."""
    where_produced = {name: step for step in steps for name in step["datasets"]}
    by_type = {step["type"]: step for step in steps}
    results = []
    for rule in load()["invariantes"]:
        if only and not any(side.get("dataset") == only for side in rule["lados"]): continue
        sides = []
        for side in rule["lados"]:
            if "metrica" in side:
                step = by_type.get(side["passo_tipo"])
                if not step or side["metrica"] not in step.get("metrics", {}): break
                value = decimal(step["metrics"][side["metrica"]])
                sides.append({"step_id": step["id"], "step_number": step["number"], "step_title": step["title"], "dataset": None,
                              "label": f"Métrica {side['metrica']}", "value": money(value)})
            else:
                step = where_produced.get(side["dataset"])
                if not step: break
                value = column_sum(rows_of(side["dataset"]), side["coluna"], side.get("menos"), side.get("filtro"))
                text = label(side["dataset"], side["coluna"])
                if side.get("menos"): text += " − " + label(side["dataset"], side["menos"])
                if side.get("filtro"): text += " (" + ", ".join(f"{label(side['dataset'], k)} = {_show(v)}" for k, v in side["filtro"].items()) + ")"
                sides.append({"step_id": step["id"], "step_number": step["number"], "step_title": step["title"], "dataset": side["dataset"],
                              "label": text, "value": money(value)})
        else:
            results.append({"id": rule["id"], "title": rule["titulo"], "ok": len({s["value"] for s in sides}) == 1, "sides": sides})
    return results


def _show(value):
    return "sim" if value is True else "não" if value is False else str(value)
