"""Stable Parquet serialization and read-only, paginated previews."""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq


def canonical(value):
    if isinstance(value, Decimal):
        if not value.is_finite(): raise ValueError("Número não finito no dataset.")
        return format(value, "f")
    if isinstance(value, (date, datetime)): return value.isoformat()
    if isinstance(value, float):
        if not math.isfinite(value): raise ValueError("Número não finito no dataset.")
        return format(Decimal(str(value)), "f")
    if isinstance(value, dict): return {str(k): canonical(v) for k, v in sorted(value.items())}
    if isinstance(value, (tuple, list)): return [canonical(v) for v in value]
    return value


def dumps(value):
    return json.dumps(canonical(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def column_type(name):
    if name.endswith("_pct") or name.endswith("_pp") or "percent" in name or name == "taxa_contratada": return "percent"
    if name in {"date", "data", "original_date", "contracted_date", "settlement_date", "start", "end"} or name.startswith("data_") or name.startswith("vigencia_"): return "date"
    if name in {"gross", "net", "reported_fee", "amount", "valor", "debito", "credito", "balance", "opening", "closing", "foreign_amount"} or name.endswith(("_brl", "_rs")):
        return "money"
    return "text"


def write_dataset(path, rows):
    path = Path(path)
    normalized = [canonical(row) for row in rows]
    if any(not isinstance(row, dict) for row in normalized): raise ValueError("Dataset deve conter objetos.")
    names = sorted({key for row in normalized for key in row})
    arrays, metadata = [], []
    for name in names:
        values = [row.get(name) for row in normalized]
        kinds = {type(value) for value in values if value is not None}
        as_json = bool(kinds & {dict, list}) or len(kinds) > 1
        if as_json:
            values = [dumps(v) if v is not None else None for v in values]
            storage = pa.string()
        elif kinds == {bool}: storage = pa.bool_()
        elif kinds == {int}: storage = pa.int64()
        else:
            values = [str(v) if v is not None else None for v in values]
            storage = pa.string()
        arrays.append(pa.array(values, type=storage))
        metadata.append({"name": name, "type": column_type(name), "storage_type": str(storage), "json": as_json})
    table = pa.Table.from_arrays(arrays, names=names)
    table = table.replace_schema_metadata({b"tarvo.schema": dumps(metadata).encode(), b"tarvo.format": b"1"})
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, path, version="2.6", compression="NONE", use_dictionary=False,
                   write_statistics=True, row_group_size=65536, data_page_version="1.0", store_schema=True)
    raw = path.read_bytes()
    return {"path": str(path), "rows": len(rows), "row_count": len(rows), "sha256": hashlib.sha256(raw).hexdigest(), "size": len(raw), "schema": metadata}


def read_dataset(path):
    table = pq.read_table(Path(path))
    columns = json.loads((table.schema.metadata or {}).get(b"tarvo.schema", b"[]"))
    json_columns = {column["name"] for column in columns if column.get("json")}
    rows = table.to_pylist()
    for row in rows:
        for key in json_columns:
            if row.get(key) is not None: row[key] = json.loads(row[key])
    return rows


def _boolean(value):
    return value is True or str(value).lower() in {"1", "true", "yes"}


def _row_key(row):
    key = next((row[k] for k in ("id", "id_saida", "source_ref", "ref_origem", "code", "name") if row.get(k) is not None), None)
    return dumps([key, row.get("physical_row", row.get("source_row", ""))]) if key is not None else dumps(row)


def preview(path, query=None, input_rows=None):
    query = query or {}
    rows = read_dataset(path)
    before_count = len(rows)
    table_schema = pq.read_schema(path)
    schema = json.loads((table_schema.metadata or {}).get(b"tarvo.schema", b"[]"))
    names = {column["name"] for column in schema}
    previous = input_rows or []
    old_columns = {key for row in previous for key in row}
    for column in schema:
        column["new"] = input_rows is not None and column["name"] not in old_columns
        column["is_new"] = column["new"]
    filters = query.get("filters", [])
    if isinstance(filters, str):
        try: filters = json.loads(filters)
        except json.JSONDecodeError as exc: raise ValueError("Filtros devem ser JSON válido.") from exc
    if isinstance(filters, dict): filters = [filters]
    if query.get("filter_column"):
        filters = [*filters, {"column": query["filter_column"], "op": query.get("filter_op", query.get("op", "eq")), "value": query.get("filter_value", query.get("value", ""))}]
    if not isinstance(filters, list): raise ValueError("Filtros devem ser uma lista.")
    for condition in filters:
        if not isinstance(condition, dict): raise ValueError("Filtro deve ser um objeto.")
        column, operation, value = condition.get("column"), condition.get("op", "eq"), condition.get("value")
        if column not in names: raise ValueError(f"Coluna desconhecida: {column}")
        if operation not in ("eq", "contains", "gt", "lt"): raise ValueError("Operador de filtro inválido.")
        def matches(row):
            actual = row.get(column)
            if operation == "eq": return str(actual) == str(value)
            if operation == "contains": return str(value).casefold() in str(actual or "").casefold()
            if actual is None: return False
            if column_type(column) in ("money", "percent"):
                try: a, b = Decimal(str(actual)), Decimal(str(value))
                except InvalidOperation: return False
                if not a.is_finite() or not b.is_finite(): return False
            else: a, b = str(actual), str(value)
            return a > b if operation == "gt" else a < b
        rows = [row for row in rows if matches(row)]
    if _boolean(query.get("only_exceptions", False)):
        rows = [row for row in rows if row.get("__exception_ids")]
    sort_by = query.get("sort_by", query.get("sort", query.get("sort_column")))
    if sort_by:
        if sort_by not in names: raise ValueError("Coluna de ordenação desconhecida.")
        def sort_key(row):
            value = row.get(sort_by)
            if value is None: return (1, "")
            if column_type(sort_by) in ("money", "percent"):
                try: return (0, Decimal(str(value)))
                except InvalidOperation: return (1, str(value))
            return (0, str(value))
        rows.sort(key=sort_key, reverse=str(query.get("sort_dir", query.get("order", "asc"))).lower() == "desc")
    try:
        page, page_size = int(query.get("page", 1)), int(query.get("page_size", 50))
    except (TypeError, ValueError) as exc: raise ValueError("Paginação inválida.") from exc
    if page < 1 or not 1 <= page_size <= 500: raise ValueError("Página deve ser positiva e page_size entre 1 e 500.")
    response = {"rows": rows[(page - 1) * page_size:page * page_size], "schema": schema, "page": page, "page_size": page_size,
                "total": len(rows), "total_rows": len(rows), "unfiltered_total": before_count, "pages": (len(rows) + page_size - 1) // page_size}
    if _boolean(query.get("diff", False)):
        old = {_row_key(row): row for row in previous}
        new = {_row_key(row): row for row in read_dataset(path)}
        added, removed = sorted(new.keys() - old.keys()), sorted(old.keys() - new.keys())
        response["diff"] = {"added": len(added), "removed": len(removed), "changed": sum(dumps(old[k]) != dumps(new[k]) for k in old.keys() & new.keys()),
                            "new_columns": sorted(names - old_columns), "added_rows": [new[k] for k in added[:page_size]], "removed_rows": [old[k] for k in removed[:page_size]]}
    return response
