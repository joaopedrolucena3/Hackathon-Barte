"""Conference reads immutable run outputs, including runs created before snapshots.

Historical shapes are simulated at the read boundary; neither source fixtures nor
the saved run, Parquet files or their metadata are rewritten by these tests.
"""
import copy
import csv
import hashlib
import io
import json
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from src.api.app import create_app
from src.store import EXPORTS, ROOT


class ConferenceHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        base = Path(cls.temp.name)
        cls.app = create_app(base/'state.sqlite3', ROOT/'data'/'case', base/'runs', mail_private_dir=base/'private')
        cls.context = TestClient(cls.app, base_url='http://127.0.0.1')
        cls.client = cls.context.__enter__()
        cls.flow = cls.app.state.workflow
        cls.headers = {'X-User': 'Revisor de teste isolado'}
        response = cls.client.post('/api/runs', headers=cls.headers,
                                   json={'pipeline_id': 'fechamento-tarvo', 'competencia': '2026-09'})
        if response.status_code != 202:
            raise AssertionError(response.text)
        cls.run_id = response.json()['run_id']
        end = time.monotonic() + 40
        while time.monotonic() < end:
            run = cls.flow.get_run(cls.run_id)
            if run['status'] in ('awaiting_approval', 'failed', 'done'):
                break
            time.sleep(.02)
        if run['status'] != 'awaiting_approval':
            raise AssertionError(run)
        cls.params = {'comp': '2026-09', 'run_id': cls.run_id}

    @classmethod
    def tearDownClass(cls):
        cls.context.__exit__(None, None, None)
        cls.temp.cleanup()

    def historical(self, *also_missing):
        original = self.flow.get_run
        def legacy(ident):
            run = copy.deepcopy(original(ident))
            for name in ('resultado_snapshot', *also_missing):
                run['datasets'].pop(name, None)
            return run
        return patch.object(self.flow, 'get_run', side_effect=legacy)

    def immutable_outputs(self):
        run = self.flow._run(self.run_id)
        return {'snapshot': copy.deepcopy(run['snapshot']), 'metadata': copy.deepcopy(run['datasets']),
                'files': {m['path']: hashlib.sha256(Path(m['path']).read_bytes()).hexdigest() for m in run['datasets'].values()}}

    def test_decisions_are_resolved_audited_and_reported_without_mutating_values(self):
        original = self.immutable_outputs()
        before = self.client.get('/api/state', params=self.params).json()
        issues = self.client.get(f'/api/runs/{self.run_id}/exceptions', params={'page_size': 500}).json()['exceptions']
        pending = {r['id_saida'] for r in before['results']['pendencias']}
        adjustable = next(i for i in issues if i['id'] in pending and len(i.get('associated_entries', [])) == 1)
        excluded = next(i for i in issues if i['id'] in pending and i['id'] != adjustable['id'] and not i.get('associated_entries'))
        accepted = next(i for i in issues if i['id'] in pending and i['id'] not in (adjustable['id'], excluded['id']))
        cases = [(accepted, {'acao': 'aceitar'}), (excluded, {'acao': 'excluir'}),
                 (adjustable, {'acao': 'ajustar', 'entry_id': adjustable['associated_entries'][0]['entry_id'],
                               'valor': adjustable['associated_entries'][0]['amount']})]
        for issue, payload in cases:
            payload['justificativa'] = 'Decisão isolada para conferir relatório e auditoria.'
            response = self.client.post(f"/api/runs/{self.run_id}/exceptions/{issue['id']}/decision", headers=self.headers, json=payload)
            self.assertEqual(response.status_code, 200, response.text)
        response = self.client.get('/api/state', params=self.params)
        self.assertEqual(response.status_code, 200, response.text)
        after = response.json()
        decisions = {i['id_saida']: i for i in after['results']['pendencias']}
        for issue, _ in cases:
            self.assertEqual(decisions[issue['id']]['status'], 'resolved')
            self.assertEqual(decisions[issue['id']]['decision']['note'], 'Decisão isolada para conferir relatório e auditoria.')
        self.assertEqual(after['summary']['resolved_issues'], before['summary']['resolved_issues'] + 3)
        self.assertEqual(after['summary']['open_issues'], before['summary']['open_issues'] - 3)
        self.assertTrue(any(record['action'] == 'exception_decision' for record in after['audit']))
        for key in ('checkout_brl', 'remessa_brl', 'notas_brl', 'divergencias_brl'):
            self.assertEqual(after['summary'][key], before['summary'][key])
        report = self.client.get('/api/report', params=self.params)
        self.assertEqual(report.status_code, 200, report.text[:300])
        self.assertIn('Decisão isolada para conferir relatório e auditoria.', report.text)
        self.assertIn('valores financeiros originais', report.text)
        archive = self.client.get('/api/export.zip', params=self.params)
        self.assertEqual(archive.status_code, 200, archive.text[:300] if archive.status_code != 200 else '')
        with zipfile.ZipFile(io.BytesIO(archive.content)) as content:
            self.assertTrue(set(EXPORTS).issubset(content.namelist()))
            self.assertIn('Decisão isolada', content.read('relatorio.html').decode())
        self.assertEqual(self.immutable_outputs(), original)
        self.assertEqual(self.flow.get_run(self.run_id)['status'], 'awaiting_approval')
        self.assertIsNone(self.flow.get_run(self.run_id)['approval'])

    def test_historical_outputs_remain_downloadable_without_recalculation(self):
        original = self.immutable_outputs()
        current = self.client.get('/api/state', params=self.params).json()
        baseline_csv = {name: self.client.get('/api/export', params={**self.params, 'file': name}).content for name in EXPORTS}
        with self.historical(), patch('src.store.calculate', side_effect=AssertionError('No recalculation allowed')):
            response = self.client.get('/api/state', params=self.params)
            self.assertEqual(response.status_code, 200, response.text)
            historical = response.json()
            self.assertEqual(historical['result_basis'], 'preserved_datasets')
            self.assertFalse(historical['unavailable_outputs'])
            self.assertTrue(historical['validation']['trace_ok'])
            for key in ('checkout_brl', 'remessa_brl', 'notas_brl', 'divergencias_brl', 'divergencias_abs_brl', 'bank_count'):
                self.assertEqual(historical['summary'][key], current['summary'][key], key)
            self.assertIsNone(historical['summary']['checkout_count'])
            self.assertGreater(historical['summary']['historical_stage_counts']['checkout_stage_rows'], 0)
            self.assertTrue(historical['audit'])
            self.assertTrue(all('banco' in row and 'debito' not in row for row in historical['results']['lancamentos']))
            for name in EXPORTS:
                response = self.client.get('/api/export', params={**self.params, 'file': name})
                self.assertEqual(response.status_code, 200, response.text[:200])
                self.assertEqual(response.content, baseline_csv[name], name)
            report = self.client.get('/api/report', params=self.params)
            self.assertEqual(report.status_code, 200)
            self.assertIn('Limitações da conferência histórica', report.text)
            archive = self.client.get('/api/export.zip', params=self.params)
            self.assertEqual(archive.status_code, 200)
            with zipfile.ZipFile(io.BytesIO(archive.content)) as content:
                for name in EXPORTS:
                    self.assertEqual(content.read(name), baseline_csv[name])
                self.assertEqual(json.loads(content.read('manifesto.json'))['result_basis'], 'preserved_datasets')
        self.assertEqual(self.immutable_outputs(), original)

    def test_missing_historical_bank_output_is_explicit_and_never_uses_erp_ledger(self):
        original = self.immutable_outputs()
        with self.historical('bancos_classificados'):
            response = self.client.get('/api/state', params=self.params)
            self.assertEqual(response.status_code, 200, response.text)
            state = response.json()
            self.assertEqual(state['results']['lancamentos'], [])
            self.assertIsNone(state['summary']['bank_count'])
            self.assertIsNone(state['validation']['trace_ok'])
            self.assertEqual(state['unavailable_outputs'][0]['dataset'], 'bancos_classificados')
            response = self.client.get('/api/export', params={**self.params, 'file': 'lancamentos_classificados.csv'})
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()['error']['code'], 'HISTORICAL_OUTPUT_UNAVAILABLE')
            report = self.client.get('/api/report', params=self.params)
            self.assertIn('não preservou o dataset bancos_classificados', report.text)
            archive = self.client.get('/api/export.zip', params=self.params)
            self.assertEqual(archive.status_code, 200)
            with zipfile.ZipFile(io.BytesIO(archive.content)) as content:
                self.assertNotIn('lancamentos_classificados.csv', content.namelist())
                self.assertIn('comissoes_por_lojista.csv', content.namelist())
                manifest = json.loads(content.read('manifesto.json'))
                self.assertEqual(manifest['unavailable_outputs'][0]['output'], 'lancamentos')
        self.assertEqual(self.immutable_outputs(), original)

    def test_missing_historical_commission_is_unknown_instead_of_zero(self):
        with self.historical('comissoes'):
            state = self.client.get('/api/state', params=self.params).json()
            self.assertIsNone(state['summary']['checkout_brl'])
            self.assertIsNone(state['summary']['remessa_brl'])
            self.assertEqual(state['summary']['notas_brl'], '246588.68')
            response = self.client.get('/api/export', params={**self.params, 'file': 'comissoes_por_lojista.csv'})
            self.assertEqual(response.status_code, 409)
            self.assertEqual(self.client.get('/api/export', params={**self.params, 'file': 'notas_a_emitir.csv'}).status_code, 200)

    def test_period_scope_is_checked_before_any_result_is_returned(self):
        response = self.client.get('/api/state', params={'comp': '2026-10', 'run_id': self.run_id})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['error']['code'], 'RUN_PERIOD_MISMATCH')


if __name__ == '__main__':
    unittest.main()
