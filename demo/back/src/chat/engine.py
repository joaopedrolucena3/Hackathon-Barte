"""Read-only SQL over the immutable outputs of one run, for the query chat.

Each run's Parquet files are materialized once into an in-memory DuckDB with a `_rid` column (row index in
the file, the same id the grid uses) and exact types: money DECIMAL(18,2), rates DECIMAL(18,6), dates DATE.
After loading, file access and configuration are locked. Model SQL must be one SELECT; float results are
refused, so every number that reaches the analyst is an exact decimal. A second, independent path
(`recompute`, Python Decimal over the stored text) checks the main figure of each answer.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

import duckdb

from . import semantic

MAX_ROWS = 1000
MAX_RIDS = 100_000
TIMEOUT_S = 10
DECIMAL_SCALE = {"money": 2, "percent": 6, "decimal": 6, "number": 6}
FLOAT_TYPES = {"DOUBLE", "FLOAT", "REAL"}
STARTERS = {"select", "with", "from", "values"}
TEMP_TABLES = ("selecao", "visao")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
COMMENT = re.compile(r"^\s*(--[^\n]*(\n|$)|/\*.*?\*/)", re.S)


class SqlRejected(ValueError):
    """A query the engine refuses or could not run; the message goes back to the model as a tool error."""


def _first_word(sql):
    text = sql
    while True:
        stripped = COMMENT.sub("", text, count=1)
        if stripped == text: break
        text = stripped
    match = re.match(r"[\s(]*([A-Za-z]+)", text)
    return match.group(1).lower() if match else ""


def guard(conn, sql):
    """One read-only statement or SqlRejected. DuckDB reports PRAGMA/SHOW as SELECT, hence the keyword check."""
    text = (sql or "").strip()
    while text.endswith(";"): text = text[:-1].rstrip()
    if not text: raise SqlRejected("Consulta vazia.")
    try:
        statements = conn.extract_statements(text)
    except duckdb.Error as exc:
        raise SqlRejected("SQL inválida: " + _clean(exc)) from None
    if len(statements) != 1:
        raise SqlRejected("Envie uma única instrução SELECT por chamada.")
    if statements[0].type != duckdb.StatementType.SELECT or _first_word(text) not in STARTERS:
        raise SqlRejected("Só consultas de leitura são aceitas (SELECT, WITH, FROM ou VALUES). DDL, DML, ATTACH, COPY, PRAGMA, SET e LOAD são recusados.")
    return text


def _clean(exc):
    lines = [line for line in str(exc).splitlines() if line.strip()]
    return " ".join(lines[:2])[:400]


def _ident(name):
    return '"' + str(name).replace('"', '""') + '"'


def plain(value):
    """DuckDB value → JSON-safe value. Decimals leave as exact text."""
    if isinstance(value, Decimal): return format(value, "f")
    if isinstance(value, datetime): return value.isoformat()
    if isinstance(value, date): return value.isoformat()
    if isinstance(value, (list, tuple)): return [plain(item) for item in value]
    if isinstance(value, dict): return {str(key): plain(item) for key, item in value.items()}
    if isinstance(value, bytes): return value.hex()
    return value


def _scale(values):
    scale = 0
    for value in values:
        exponent = value.as_tuple().exponent
        if isinstance(exponent, int): scale = max(scale, -exponent)
    return scale


def _column_plan(column, rows):
    """SQL type and select expression for one stored column. Values that do not parse keep the text type."""
    name, kind = column["name"], column["kind"]
    present = [row.get(name) for row in rows if row.get(name) not in (None, "")]
    text = f"CAST({_ident(name)} AS VARCHAR)"
    typed = lambda sql_type: (sql_type, f"CAST(NULLIF({text}, '') AS {sql_type})")
    if kind in DECIMAL_SCALE:
        try: numbers = [Decimal(str(value)) for value in present if not isinstance(value, bool)]
        except InvalidOperation: return "VARCHAR", text
        if len(numbers) != len(present) or not all(number.is_finite() for number in numbers): return "VARCHAR", text
        scale = max(DECIMAL_SCALE[kind], _scale(numbers))
        digits = max([len(str(abs(int(number)))) for number in numbers] or [1])
        if digits + scale <= 18: return typed(f"DECIMAL(18,{scale})")
        return typed(f"DECIMAL(38,{scale})") if digits + scale <= 38 else ("VARCHAR", text)
    if kind == "integer":
        if all((isinstance(value, int) and not isinstance(value, bool)) or re.fullmatch(r"-?\d+", str(value)) for value in present): return typed("BIGINT")
        return "VARCHAR", text
    if kind == "date":
        if all(isinstance(value, str) and ISO_DATE.match(value) for value in present): return typed("DATE")
        return "VARCHAR", text
    if kind == "boolean" and all(isinstance(value, bool) for value in present): return "BOOLEAN", _ident(name)
    return "VARCHAR", text


class Engine:
    """Materialized tables of one run. Built from `PipelineService.run_outputs`; never written after load."""

    def __init__(self, sources):
        self.run = sources["run"]
        self.steps = sources["steps"]
        self.rows_of = sources["rows_of"]
        self.key = tuple(sorted((meta["name"], meta["sha256"]) for meta in sources["outputs"]))
        self.lock = threading.Lock()
        self.tables = {}
        self.conn = duckdb.connect(":memory:", config={"threads": 2, "memory_limit": "512MB"})
        step_of = {step["id"]: step for step in self.steps}
        for meta in sources["outputs"]:
            self._load(meta, step_of[meta["step_id"]])
        self.conn.execute("SET enable_external_access = false")
        self.conn.execute("SET lock_configuration = true")

    def _load(self, meta, step):
        name, rows = meta["name"], self.rows_of(meta["name"])
        hidden = set(semantic.load()["ocultas"])
        columns, select = [], ["file_row_number AS _rid"]
        for column in semantic.describe(name, meta.get("schema", [])):
            if column["name"] in hidden: continue
            sql_type, expression = _column_plan(column, rows)
            select.append(f"{expression} AS {_ident(column['name'])}")
            distinct = None
            if sql_type == "VARCHAR" and column["kind"] == "text":
                values = {row.get(column["name"]) for row in rows if row.get(column["name"]) not in (None, "")}
                if 0 < len(values) <= 30 and len(values) < len(rows): distinct = sorted(map(str, values))
            columns.append({**column, "sql_type": sql_type, "distinct": distinct})
        path = "'" + str(meta["path"]).replace("'", "''") + "'"
        if columns:
            self.conn.execute(f"CREATE TABLE {_ident(name)} AS SELECT {', '.join(select)} FROM read_parquet({path}, file_row_number = true)")
        else:  # An empty output has no Parquet columns to read.
            self.conn.execute(f"CREATE TABLE {_ident(name)} (_rid BIGINT)")
        count = self.conn.execute(f"SELECT COUNT(*) FROM {_ident(name)}").fetchone()[0]
        if count != len(rows): raise RuntimeError(f"Tabela {name} carregou {count} linhas; o arquivo tem {len(rows)}.")
        self.tables[name] = {"name": name, "step": step, "rows": len(rows), "sha256": meta["sha256"], "columns": columns}

    def session(self, selection=None, view=None):
        return Session(self, selection, view)

    def close(self):
        self.conn.close()


class Session:
    """One chat request: its own DuckDB cursor, the analyst's selection and filtered view as temp tables."""

    def __init__(self, engine, selection=None, view=None):
        self.engine = engine
        with engine.lock:
            self.cur = engine.conn.cursor()
        for table, rids in zip(TEMP_TABLES, (selection, view)):
            self.cur.execute(f"CREATE TEMP TABLE {table} (_rid BIGINT)")
            if rids: self.cur.execute(f"INSERT INTO {table} SELECT UNNEST(?::BIGINT[])", [sorted({int(rid) for rid in rids})[:MAX_RIDS]])

    def query(self, sql, limit=MAX_ROWS):
        text = guard(self.cur, sql)
        timer = threading.Timer(TIMEOUT_S, self.cur.interrupt)
        start = time.perf_counter()
        timer.start()
        try:
            relation = self.cur.execute(text)
            fetched = relation.fetchmany(limit + 1)
            description = relation.description or []
        except duckdb.InterruptException:
            raise SqlRejected(f"A consulta passou de {TIMEOUT_S} s e foi interrompida. Simplifique ou agregue antes.") from None
        except duckdb.PermissionException:
            raise SqlRejected("Acesso a arquivos e extensões está bloqueado. Consulte só as tabelas do run.") from None
        except duckdb.Error as exc:
            raise SqlRejected(_clean(exc)) from None
        finally:
            timer.cancel()
        columns = [{"name": item[0], "type": str(item[1])} for item in description]
        floats = [column["name"] for column in columns if column["type"] in FLOAT_TYPES]
        if floats:
            raise SqlRejected(f"Coluna em ponto flutuante ({', '.join(floats)}): médias e divisões voltam como DOUBLE e perdem exatidão. "
                              "Converta com ROUND(expr, 2)::DECIMAL(18,2) para dinheiro ou ROUND(expr, 6)::DECIMAL(18,6) para taxas e proporções.")
        if len({column["name"] for column in columns}) != len(columns):
            raise SqlRejected("Há colunas com o mesmo nome no resultado. Dê um alias único a cada coluna.")
        rows = [[plain(value) for value in row] for row in fetched[:limit]]
        digest = hashlib.sha256(json.dumps({"columns": columns, "rows": rows}, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return {"columns": columns, "rows": rows, "row_count": len(rows), "truncated": len(fetched) > limit,
                "ms": round((time.perf_counter() - start) * 1000), "sha256": digest}

    def rids(self, dataset, where=None):
        """Rows of a table that satisfy a WHERE clause, in file order (row ids for highlights and checks)."""
        if dataset not in self.engine.tables: raise SqlRejected(f"Tabela desconhecida: {dataset}.")
        sql = f"SELECT _rid FROM {_ident(dataset)}" + (f" WHERE {where}" if where and where.strip() else "") + " ORDER BY _rid"
        result = self.query(sql, limit=MAX_RIDS)
        if [column["name"] for column in result["columns"]] != ["_rid"]: raise SqlRejected("O filtro deve selecionar só linhas da tabela.")
        return [row[0] for row in result["rows"]], result["truncated"]

    def close(self):
        self.cur.close()


AGGREGATIONS = {"soma", "contagem", "media", "minimo", "maximo"}


def recompute(session, dataset, column, aggregation, where=None):
    """Independent path for a figure: DuckDB only picks the rows; the value is aggregated in Python Decimal
    from the text stored in Parquet. Returns (value, rows considered)."""
    if aggregation not in AGGREGATIONS: raise SqlRejected(f"Agregação desconhecida: {aggregation}.")
    table = session.engine.tables.get(dataset)
    if not table: raise SqlRejected(f"Tabela desconhecida: {dataset}.")
    rids, truncated = session.rids(dataset, where)
    if truncated: raise SqlRejected("Linhas demais para recalcular.")
    if aggregation == "contagem" and not column: return Decimal(len(rids)), len(rids)
    if column not in {item["name"] for item in table["columns"]}: raise SqlRejected(f"Coluna desconhecida em {dataset}: {column}.")
    rows = session.engine.rows_of(dataset)
    try: values = [semantic.decimal(rows[rid].get(column)) for rid in rids]
    except ValueError: raise SqlRejected(f"A coluna {column} não é numérica.") from None
    values = [value for value in values if value is not None]
    if aggregation == "contagem": return Decimal(len(values)), len(rids)
    if not values: return None, len(rids)
    if aggregation == "soma": return sum(values, Decimal(0)), len(rids)
    if aggregation == "minimo": return min(values), len(rids)
    if aggregation == "maximo": return max(values), len(rids)
    return sum(values, Decimal(0)) / len(values), len(rids)


def same(expected, obtained):
    """Equal as numbers; an average is compared at the scale the query rounded it to (ROUND_HALF_UP)."""
    if expected is None or obtained is None: return expected is obtained
    exponent = obtained.as_tuple().exponent
    if isinstance(exponent, int) and exponent < 0 and expected.as_tuple().exponent != exponent:
        expected = expected.quantize(Decimal(1).scaleb(exponent), rounding=ROUND_HALF_UP)
    return expected == obtained


class Engines:
    """One materialized engine per run, rebuilt when any output hash changes. Small LRU."""

    def __init__(self, size=4):
        self.size, self.items, self.lock = size, {}, threading.Lock()

    def get(self, sources):
        key = tuple(sorted((meta["name"], meta["sha256"]) for meta in sources["outputs"]))
        run_id = sources["run"]["id"]
        with self.lock:
            engine = self.items.pop(run_id, None)
            if engine and engine.key != key:
                engine.close()
                engine = None
            if engine is None: engine = Engine(sources)
            self.items[run_id] = engine
            while len(self.items) > self.size:
                self.items.pop(next(iter(self.items))).close()
            return engine

    def close(self):
        with self.lock:
            for engine in self.items.values(): engine.close()
            self.items.clear()
