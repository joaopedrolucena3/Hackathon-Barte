"""Grouped registration issues retain unknown amounts and complete review evidence."""
import copy
import csv
import io
import json
import threading
import tempfile
import unittest
import zipfile
from pathlib import Path

from src.api.conference import export_zip, official_csv, run_state
from src.api.insights import build_insights
from src.mail.evidence import attachments_for, build_evidence, template
from src.pipeline.recommendations import build_recommendations
from src.pipeline import datasets
from src.chat import semantic


def grouped_issue():
    operations = [
        {'id': 'TX1', 'ref': 'TX1', 'arquivo': 'orbe.csv', 'linha': 2, 'date': '2026-09-01',
         'business': 'CHECKOUT', 'exposure_brl': '12.00', 'exposure_basis': 'reported_fee'},
        {'id': 'TX2', 'ref': 'TX2', 'arquivo': 'orbe.csv', 'linha': 3, 'date': '2026-09-02',
         'business': 'CHECKOUT', 'exposure_brl': None, 'exposure_basis': 'reported_fee'},
    ]
    return {'id_saida': 'PEND-GROUP', 'tipo': 'CADASTRO_NAO_CONFIRMADO', 'ref_origem': 'TX1',
            'valor_brl': None, 'severity': 'bloqueante', 'motivo': 'Cadastro candidato.',
            'quem_decide': 'Comercial', 'rule': 'Identidade e contrato vigente obrigatórios.',
            'cnpj': '12345678000190', 'merchant_name': 'Empresa candidata', 'period': '2026-09',
            'group_scope': 'merchant_period', 'operation_count': 2, 'affected_operations': operations,
            'exposure_status': 'partial', 'known_exposure_brl': '12.00', 'missing_exposure_count': 1,
            'source_fingerprint': 'preserved-content', 'status': 'open',
            'evidence': [{'arquivo': 'orbe.csv', 'ref': op['ref'], 'linha': op['linha'],
                          'source_sha256': 'group-file', 'source_receipt_id': 'receipt-1'} for op in operations]}


def result_for(issue):
    result = {key: [] for key in ('comissoes', 'divergencias', 'notas', 'lancamentos', 'rastro', 'details')}
    result.update(pendencias=[copy.deepcopy(issue)], summary={})
    for op in issue['affected_operations']:
        trace = {'id_saida': issue['id_saida'], 'arquivo_origem': op['arquivo'], 'ref_origem': op['ref'],
                 'source_row': op['linha'], 'valor': op['exposure_brl'], 'regra': issue['rule']}
        result['rastro'].append(trace)
        result['details'].append({**trace, 'affected_operation': copy.deepcopy(op), 'group_scope': 'merchant_period', 'period': issue['period']})
    return result


class SnapshotFlow:
    def __init__(self, result):
        self.lock = threading.RLock()
        self.result = result
        self.run = {'id': 'run-1', 'competencia': '2026-09', 'status': 'awaiting_approval',
                    'created_by': 'Analista', 'finished_at': None, 'snapshot': {'references': {}, 'assumptions': []},
                    'datasets': {'resultado_snapshot': {'name': 'resultado_snapshot'}}}

    def get_run(self, ident): return copy.deepcopy(self.run)
    def _rows(self, meta): return [copy.deepcopy(self.result)]
    def _exceptions(self, ident):
        return [{**copy.deepcopy(row), 'id': row['id_saida'], 'severidade': 'bloqueante'} for row in self.result['pendencias']]
    def audit(self, ident): return {'records': []}


class SourceStore:
    def __init__(self, issue):
        self.lock = threading.RLock()
        self.result = result_for(issue)
        self.source = {'checkout': [
            {'id': op['id'], 'source_ref': op['ref'], 'source_file': op['arquivo'], 'physical_row': op['linha'],
             'date': op['date'], 'reported_fee': op['exposure_brl'], 'ec': 'EC1', 'type': 'VENDA',
             'source_sha256': 'group-file', 'source_receipt_id': 'receipt-1'} for op in issue['affected_operations']]}
        # Same display name, reference and line are insufficient to select a receipt.
        self.source['checkout'].append({**self.source['checkout'][0], 'ec': 'OTHER',
                                        'source_sha256': 'different-file', 'source_receipt_id': 'receipt-other'})

    def state(self): return {}
    def _results(self): return copy.deepcopy(self.result)
    def get(self, key, default=None):
        return {'period': '2026-09', 'source_data': self.source, 'parameters': {}}.get(key, default)
    def records(self, table):
        return [{'cnpj': '12345678000190', 'name': 'Empresa candidata', 'ec': 'EC1'}] if table == 'merchants' else []


class RegistrationSurfaceTests(unittest.TestCase):
    def test_preview_omits_incomplete_column_totals_but_keeps_complete_page_total(self):
        with tempfile.TemporaryDirectory() as folder:
            for name, column in [('pendencias', 'valor_brl'), ('rastro', 'valor'), ('detalhes_calculo', 'valor')]:
                with self.subTest(dataset=name):
                    path = Path(folder) / f'{name}.parquet'
                    datasets.write_dataset(path, [{'id': 'known', column: '12.00'}, {'id': 'unknown', column: None}])
                    preview = datasets.preview(path, {'page_size': 1})
                    self.assertNotIn(column, preview['totals']['all'])
                    self.assertEqual(preview['totals']['page'][column], '12.00')
                    unknown_page = datasets.preview(path, {'page_size': 1, 'page': 2})
                    self.assertNotIn(column, unknown_page['totals']['page'])

    def test_step_data_omits_partial_and_unknown_totals(self):
        columns = [{'name': 'valor_brl', 'kind': 'money'}]
        for missing in (None, ''):
            with self.subTest(missing=missing):
                self.assertEqual(semantic.totals('pendencias', columns, [{'valor_brl': '12.00'}, {'valor_brl': missing}]), [])
                self.assertEqual(semantic.totals('pendencias', columns, [{'valor_brl': missing}]), [])
        complete = semantic.totals('pendencias', columns, [{'valor_brl': '12.00'}, {'valor_brl': '-2.00'}])
        self.assertEqual(complete[0]['value'], '10.00')

    def test_excluded_commissions_keep_eligible_output_totals(self):
        rows = [{'id': 'billable', 'gross': '100.00', 'net': '97.00', 'comissao_brl': '3.00'},
                {'id': 'not-billable', 'gross': '200.00', 'net': '195.00', 'comissao_brl': None}]
        expected = {'gross': '300.00', 'net': '292.00', 'comissao_brl': '3.00'}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'checkout_calculado.parquet'
            datasets.write_dataset(path, rows)
            self.assertEqual(datasets.preview(path)['totals']['all'], expected)
        columns = [{'name': key, 'kind': 'money'} for key in expected]
        totals = semantic.totals('checkout_calculado', columns, rows)
        self.assertEqual({item['column']: item['value'] for item in totals}, expected)

    def test_partial_trace_is_valid_without_converting_missing_value_to_zero(self):
        result = result_for(grouped_issue())
        original = copy.deepcopy(result)
        state = run_state(SnapshotFlow(result), SourceStore(grouped_issue()), 'run-1')
        self.assertTrue(state['validation']['trace_ok'])
        self.assertIsNone(state['results']['pendencias'][0]['valor_brl'])
        self.assertIsNone(state['results']['rastro'][1]['valor'])
        self.assertEqual(result, original)

    def test_unknown_trace_metadata_must_reconcile(self):
        for field, value in [('known_exposure_brl', '11.00'), ('missing_exposure_count', 2), ('operation_count', 3)]:
            with self.subTest(field=field):
                issue = grouped_issue()
                issue[field] = value
                state = run_state(SnapshotFlow(result_for(issue)), SourceStore(grouped_issue()), 'run-1')
                self.assertFalse(state['validation']['trace_ok'])

    def test_official_csv_preserves_public_headers_and_manifest_retains_group_evidence(self):
        issue = grouped_issue()
        result = result_for(issue)
        reader = csv.DictReader(io.StringIO(official_csv({'results': result}, 'pendencias.csv').decode()), delimiter=';')
        self.assertEqual(reader.fieldnames, ['id_saida', 'tipo', 'ref_origem', 'valor_brl', 'motivo', 'quem_decide'])
        rows = list(reader)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['valor_brl'], '')
        reader = csv.DictReader(io.StringIO(official_csv({'results': result}, 'rastro.csv').decode()), delimiter=';')
        self.assertEqual(reader.fieldnames, ['id_saida', 'arquivo_origem', 'ref_origem', 'valor'])
        trace = list(reader)
        self.assertEqual([row['valor'] for row in trace], ['12.00', ''])
        state = {'results': result, 'run_id': 'run-1', 'period': '2026-09', 'sources': [],
                 'closing': {'status': 'awaiting_approval'}, 'summary': {'open_issues': 1}, 'assumptions': []}
        original = copy.deepcopy(state)
        with zipfile.ZipFile(io.BytesIO(export_zip(state))) as archive:
            manifest = json.loads(archive.read('manifesto.json'))
            self.assertEqual(set(archive.namelist()), set(manifest['files']) | {'relatorio.html', 'manifesto.json'})
        group = manifest['registration_groups'][0]
        self.assertEqual({key: group[key] for key in issue}, issue)
        self.assertEqual(group['trace'], result['rastro'])
        self.assertEqual(group['details'], result['details'])
        self.assertIsNone(group['valor_brl'])
        self.assertEqual(group['known_exposure_brl'], '12.00')
        self.assertEqual(state, original)

    def test_insights_keep_partial_subtotal_distinct_from_unknown_total(self):
        output = build_insights('2026-09', result_for(grouped_issue()))['pendencias']
        self.assertIsNone(output['open_brl'])
        self.assertEqual(output['known_open_brl'], '12.00')
        self.assertEqual(output['missing_open_exposure_count'], 1)
        self.assertEqual(output['open_count'], 1)
        self.assertIsNone(output['by_type'][0]['brl'])
        self.assertEqual(output['by_type'][0]['known_brl'], '12.00')

    def test_resolved_review_keeps_unknown_exposure_explicit(self):
        issue = grouped_issue()
        issue['status'] = 'resolved'
        output = build_insights('2026-09', result_for(issue))['pendencias']
        self.assertEqual(output['open_brl'], '0.00')
        self.assertIsNone(output['resolved_brl'])
        self.assertEqual(output['known_resolved_brl'], '12.00')
        self.assertEqual(output['missing_resolved_exposure_count'], 1)

    def test_recommendation_preserves_scope_without_auto_accept(self):
        issue = grouped_issue()
        output = build_recommendations([issue], [{'id': 'H03'}])[0]
        self.assertFalse(output['eligible'])
        self.assertEqual(output['suggested_action'], 'wait')
        self.assertIsNone(output['exposure_brl'])
        self.assertEqual(output['operation_count'], 2)
        self.assertEqual(output['known_exposure_brl'], '12.00')
        output['affected_operations'][0]['id'] = 'CHANGED'
        self.assertEqual(issue['affected_operations'][0]['id'], 'TX1')

    def test_mail_preserves_all_group_origins_without_crossing_receipts(self):
        issue = grouped_issue()
        evidence = build_evidence(SourceStore(issue), issue['id_saida'])
        self.assertFalse(evidence['blockers'])
        self.assertEqual(len(evidence['rows']), 2)
        self.assertEqual({row['source_receipt_id'] for row in evidence['rows']}, {'receipt-1'})
        self.assertEqual(len(evidence['calculation']), 2)
        _, body = template(evidence)
        self.assertIn('Operações afetadas nesta competência: 2', body)
        self.assertIn('Subtotal conhecido (R$): 12.00', body)
        self.assertIn('não libera faturamento', body)
        self.assertNotIn('None', body)
        html = next(item['data'].decode() for item in attachments_for(evidence) if item['name'] == 'evidencias.html')
        self.assertIn('Operações afetadas pelo cadastro', html)
        self.assertIn('Não informado', html)
        self.assertNotIn('None', html)


if __name__ == '__main__':
    unittest.main()
