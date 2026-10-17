"""Chat query engine: read-only guard, exact decimal types, limits, row ids and the independent recalculation."""
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from unittest import mock

from src.chat import engine as chat_engine
from src.chat.engine import Engine, Engines, SqlRejected, recompute, same
from src.pipeline.datasets import read_dataset, write_dataset


def sources(base, rows=None):
    """A two-step run written with the pipeline's own Parquet writer."""
    rows = rows if rows is not None else [
        {'id': f'TX{i:04d}', 'date': f'2026-09-{1 + i % 28:02d}', 'brand': 'ELO' if i % 3 == 0 else 'VISA', 'gross': '0.10' if i % 2 else '0.20',
         'impacto_rs': '4715852.69' if i == 0 else '0.01', 'original_date': '' if i % 5 else '2026-08-30', '__exception_ids': ['PEND-1'] if i == 1 else []}
        for i in range(1500)]
    meta = write_dataset(Path(base) / 'steps' / 's4' / 'mdr_conferido.parquet', rows)
    notes = write_dataset(Path(base) / 'steps' / 's8' / 'notas.parquet', [{'id_saida': 'N1', 'valor_brl': '10.00'}])
    outputs = [{**meta, 'name': 'mdr_conferido', 'step_id': 's4'}, {**notes, 'name': 'notas', 'step_id': 's8'}]
    paths = {item['name']: item['path'] for item in outputs}
    cache = {}

    def rows_of(name):
        if name not in cache: cache[name] = read_dataset(paths[name])
        return cache[name]
    steps = [{'id': 's4', 'number': 4, 'type': 'conferir_mdr', 'title': 'Conferir MDR', 'status': 'done', 'metrics': {}, 'datasets': ['mdr_conferido']},
             {'id': 's8', 'number': 8, 'type': 'gerar_lancamentos', 'title': 'Gerar lançamentos', 'status': 'done', 'metrics': {}, 'datasets': ['notas']}]
    return {'run': {'id': 'run-teste', 'competencia': '2026-09', 'status': 'done'}, 'steps': steps, 'outputs': outputs, 'rows_of': rows_of}


class EngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.sources = sources(cls.temp.name)
        cls.engine = Engine(cls.sources)

    @classmethod
    def tearDownClass(cls):
        cls.engine.close()
        cls.temp.cleanup()

    def setUp(self):
        self.session = self.engine.session()

    def tearDown(self):
        self.session.close()

    def rejected(self, sql):
        with self.assertRaises(SqlRejected, msg=sql) as caught:
            self.session.query(sql)
        return str(caught.exception)

    def test_guard_refuses_anything_but_one_select(self):
        path = self.sources['outputs'][0]['path']
        for sql in ['CREATE TABLE x AS SELECT 1', 'DROP TABLE mdr_conferido', "INSERT INTO mdr_conferido (id) VALUES ('X')",
                    "UPDATE mdr_conferido SET gross = 0", 'DELETE FROM mdr_conferido', "ATTACH ':memory:' AS outra", "COPY mdr_conferido TO 'saida.csv'",
                    'PRAGMA version', 'SET threads = 8', 'LOAD httpfs', 'INSTALL httpfs', 'CALL pragma_version()', "EXPORT DATABASE 'x'",
                    'SELECT 1; SELECT 2', 'SUMMARIZE mdr_conferido', "SELECT * FROM read_csv('/etc/hosts')",
                    f"SELECT * FROM read_parquet('{path}')", "SELECT * FROM glob('/etc/*')", 'SET enable_external_access = true']:
            self.rejected(sql)
        self.assertIn('única instrução', self.rejected('SELECT 1; DROP TABLE notas'))
        self.assertIn('bloqueado', self.rejected("SELECT * FROM read_csv('/etc/hosts')"))
        self.assertEqual(self.session.query('SELECT COUNT(*) AS n FROM mdr_conferido')['rows'], [[1500]])

    def test_guard_accepts_select_forms(self):
        for sql in ['SELECT 1 AS um', 'select 1 as um;', '/* comentário */ SELECT 1 AS um', '-- linha\nWITH a AS (SELECT 1 AS um) SELECT * FROM a',
                    '(SELECT 1 AS um)', 'FROM notas SELECT valor_brl', 'VALUES (1)']:
            self.assertTrue(self.session.query(sql)['rows'], sql)

    def test_types_follow_the_semantic_layer(self):
        columns = {column['name']: column['sql_type'] for column in self.engine.tables['mdr_conferido']['columns']}
        self.assertEqual((columns['gross'], columns['impacto_rs'], columns['date'], columns['original_date'], columns['brand']),
                         ('DECIMAL(18,2)', 'DECIMAL(18,2)', 'DATE', 'DATE', 'VARCHAR'))
        self.assertEqual(self.engine.tables['mdr_conferido']['columns'][[c['name'] for c in self.engine.tables['mdr_conferido']['columns']].index('brand')]['distinct'], ['ELO', 'VISA'])
        result = self.session.query('SELECT COUNT(*) AS vazias FROM mdr_conferido WHERE original_date IS NULL')
        self.assertEqual(result['rows'], [[1200]])

    def test_sums_are_exact_decimals(self):
        result = self.session.query('SELECT SUM(gross) AS bruto, SUM(impacto_rs) AS impacto FROM mdr_conferido')
        rows = self.sources['rows_of']('mdr_conferido')
        self.assertEqual(result['rows'], [[format(sum(Decimal(r['gross']) for r in rows), 'f'), format(sum(Decimal(r['impacto_rs']) for r in rows), 'f')]])
        self.assertEqual(result['rows'][0], ['225.00', '4715867.68'])
        self.assertEqual(result['columns'][0]['type'], 'DECIMAL(38,2)')

    def test_float_results_are_refused_with_the_fix(self):
        message = self.rejected('SELECT AVG(gross) AS media FROM mdr_conferido')
        self.assertIn('DECIMAL(18,2)', message)
        self.rejected('SELECT SUM(gross) / COUNT(*) AS media FROM mdr_conferido')
        self.assertEqual(self.session.query('SELECT ROUND(AVG(gross), 2)::DECIMAL(18,2) AS media FROM mdr_conferido')['rows'], [['0.15']])

    def test_row_ids_follow_the_file_and_results_are_capped(self):
        result = self.session.query('SELECT _rid, id FROM mdr_conferido ORDER BY _rid')
        self.assertEqual(result['rows'][:2], [[0, 'TX0000'], [1, 'TX0001']])
        self.assertEqual((result['row_count'], result['truncated']), (1000, True))
        self.assertEqual(len(result['sha256']), 64)
        self.assertEqual(self.session.query('SELECT _rid, id FROM mdr_conferido ORDER BY _rid')['sha256'], result['sha256'])
        self.assertIn('alias', self.rejected('SELECT 1 AS a, 2 AS a'))

    def test_slow_queries_are_interrupted(self):
        with mock.patch.object(chat_engine, 'TIMEOUT_S', 0.3):
            message = self.rejected('WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT COUNT(*) AS n FROM r')
        self.assertIn('interrompida', message)

    def test_selection_and_view_are_per_session(self):
        mine = self.engine.session(selection=[0, 2, 4], view=[1, 2])
        other = self.engine.session(selection=[3])
        try:
            self.assertEqual(mine.query('SELECT SUM(gross) AS s FROM mdr_conferido WHERE _rid IN (SELECT _rid FROM selecao)')['rows'], [['0.60']])
            self.assertEqual(mine.query('SELECT COUNT(*) AS n FROM visao')['rows'], [[2]])
            self.assertEqual(other.query('SELECT COUNT(*) AS n FROM selecao')['rows'], [[1]])
            self.assertEqual(other.query('SELECT COUNT(*) AS n FROM visao')['rows'], [[0]])
        finally:
            mine.close()
            other.close()

    def test_recompute_is_independent_of_sql_aggregation(self):
        value, rows = recompute(self.session, 'mdr_conferido', 'gross', 'soma', "brand = 'ELO'")
        expected = sum(Decimal(r['gross']) for r in self.sources['rows_of']('mdr_conferido') if r['brand'] == 'ELO')
        self.assertEqual((value, rows), (expected, 500))
        self.assertEqual(recompute(self.session, 'mdr_conferido', None, 'contagem', None), (Decimal(1500), 1500))
        average, _ = recompute(self.session, 'mdr_conferido', 'gross', 'media', None)
        self.assertTrue(same(average, Decimal('0.15')))
        self.assertFalse(same(average, Decimal('0.16')))
        self.assertTrue(same(Decimal('4715852.69'), Decimal('4715852.690')))
        with self.assertRaises(SqlRejected): recompute(self.session, 'mdr_conferido', 'inexistente', 'soma', None)
        with self.assertRaises(SqlRejected): recompute(self.session, 'mdr_conferido', 'gross', 'soma', 'DROP TABLE notas')


class EnginesCacheTests(unittest.TestCase):
    def test_rebuilds_when_an_output_changes(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            engines = Engines()
            try:
                a = engines.get(sources(first))
                self.assertIs(engines.get(sources(first)), a)
                b = engines.get(sources(second, rows=[{'id': 'TX1', 'gross': '1.00'}]))
                self.assertIsNot(a, b)
                self.assertEqual(b.session().query('SELECT SUM(gross) AS s FROM mdr_conferido')['rows'], [['1.00']])
            finally:
                engines.close()

    def test_empty_output_still_becomes_a_table(self):
        with tempfile.TemporaryDirectory() as base:
            engine = Engine(sources(base, rows=[]))
            try:
                self.assertEqual(engine.session().query('SELECT COUNT(*) AS n FROM mdr_conferido')['rows'], [[0]])
            finally:
                engine.close()


if __name__ == '__main__':
    unittest.main()
