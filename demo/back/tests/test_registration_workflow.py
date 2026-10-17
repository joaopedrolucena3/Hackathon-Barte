"""Registration grouping through persistent decisions and immutable runs."""
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from src.pipeline.service import PipelineService, ServiceError
from src.store import Store


PACK = Path(__file__).resolve().parents[1] / 'data' / 'case'
ACTOR = 'Revisão cadastral de teste'


class RegistrationWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tarvo-registration-workflow-')
        self.base = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def store(self):
        store = Store(self.base / 'closing.sqlite3', PACK)
        self.addCleanup(store.close_db)
        return store

    def group(self, rows):
        groups = [row for row in rows if row['tipo'] == 'CADASTRO_NAO_CONFIRMADO']
        self.assertEqual(len(groups), 1)
        return groups[0]

    def test_store_decision_covers_exact_group_and_changed_members_reopen_it(self):
        store = self.store()
        initial = store.state()
        group = self.group(initial['results']['pendencias'])
        self.assertEqual(group['operation_count'], 57)
        self.assertTrue(initial['validation']['trace_ok'])
        self.assertEqual(sum(Decimal(r['valor']) for r in initial['results']['rastro'] if r['id_saida'] == group['id_saida']), Decimal(group['valor_brl']))
        with self.assertRaises(ValueError):
            store.mutate('decisions', {'actor': ACTOR, 'id': group['id_saida'], 'action': 'adjust', 'note': 'Ajuste não regulariza cadastro'})
        store.mutate('decisions', {'actor': ACTOR, 'id': group['id_saida'], 'action': 'confirm', 'note': 'Aguardar Comercial; sem faturar'})
        accepted = self.group(store.state()['results']['pendencias'])
        self.assertEqual(accepted['status'], 'resolved')
        self.assertEqual(accepted['decision']['affected_operations'], group['affected_operations'])
        self.assertEqual(accepted['decision']['operation_count'], 57)
        self.assertFalse(accepted['decision']['billing_authorized'])
        store.mutate('recalculate', {'actor': ACTOR, 'period': '2026-09'})
        self.assertEqual(self.group(store.state()['results']['pendencias'])['status'], 'resolved')
        source = deepcopy(store.get('source_data'))
        member = group['affected_operations'][0]
        added = deepcopy(next(r for r in source['checkout'] if r['id'] == member['id']))
        added.update(id='TX-GROUP-NEW', source_ref='TX-GROUP-NEW', physical_row=99999)
        added.pop('provenances', None)
        source['checkout'].append(added)
        with store.lock, store.db:
            store.put('source_data', source)
            store._recalculate(ACTOR)
        current = store.state()
        reopened = self.group(current['results']['pendencias'])
        self.assertEqual(reopened['id_saida'], group['id_saida'])
        self.assertEqual(reopened['operation_count'], 58)
        self.assertEqual(reopened['status'], 'open')
        self.assertIsNone(reopened['decision'])
        self.assertNotEqual(reopened['source_fingerprint'], group['source_fingerprint'])
        self.assertTrue(current['validation']['trace_ok'])
        for dataset in ('comissoes', 'notas', 'lancamentos'):
            self.assertEqual(current['results'][dataset], initial['results'][dataset])

    def test_missing_exposure_has_valid_partial_trace_and_explicit_warning(self):
        store = self.store()
        group = self.group(store.state()['results']['pendencias'])
        source = deepcopy(store.get('source_data'))
        member = group['affected_operations'][0]
        row = next(r for r in source['checkout'] if r['id'] == member['id'])
        row['reported_fee'] = None
        with store.lock, store.db:
            store.put('source_data', source)
            store._recalculate(ACTOR)
        state = store.state()
        changed = self.group(state['results']['pendencias'])
        self.assertIsNone(changed['valor_brl'])
        self.assertEqual(changed['missing_exposure_count'], 1)
        self.assertEqual(changed['exposure_status'], 'partial')
        self.assertTrue(state['validation']['trace_ok'], state['validation'])
        self.assertTrue(any('Valor total indisponível' in str(w) for w in state['validation']['warnings']))
        self.assertIn('Total indisponível', store.report())

    def test_pipeline_single_decision_preserves_ledger_and_new_run_starts_open(self):
        with patch('src.pipeline.service.PACKS_ROOT', self.base):
            service = PipelineService(self.base / 'workflow.sqlite3', PACK, self.base / 'runs')
            self.addCleanup(service.close)
            def start():
                ident = service.start_run({'pipeline_id': 'fechamento-tarvo', 'competencia': '2026-09'}, ACTOR)['run_id']
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    run = service.get_run(ident)
                    if run['status'] in ('awaiting_approval', 'failed'):
                        self.assertEqual(run['status'], 'awaiting_approval', run.get('error'))
                        return run
                    time.sleep(.02)
                self.fail('Execução não chegou à revisão.')
            run = start()
            group = self.group(service.exceptions(run['id'], {'page_size': 500})['items'])
            self.assertEqual(group['operation_count'], 57)
            self.assertEqual(group['merchant'], group['merchant_name'])
            self.assertNotIn('amount', group)
            self.assertNotIn('date', group)
            before = service.approval_summary(run['id'])
            ledger = Path(run['datasets']['lancamentos']['path'])
            raw = ledger.read_bytes()
            with self.assertRaises(ServiceError) as raised:
                service.decision(run['id'], group['id'], {'acao': 'ajustar', 'valor': '1.00', 'justificativa': 'Não autorizado'}, ACTOR)
            self.assertEqual(raised.exception.code, 'REGISTRATION_REQUIRES_REPROCESSING')
            result = service.decision(run['id'], group['id'], {'acao': 'aceitar', 'justificativa': 'Ressalva de cadastro, sem faturamento'}, ACTOR)
            self.assertEqual(result['status'], 'accepted')
            self.assertFalse(result['decision']['billing_authorized'])
            self.assertEqual(result['decision']['affected_operations'], group['affected_operations'])
            after = service.approval_summary(run['id'])
            self.assertEqual(after['open_blocking'], before['open_blocking'] - 1)
            self.assertGreater(after['open_blocking'], 0)
            self.assertEqual(after['batch'], before['batch'])
            self.assertEqual(ledger.read_bytes(), raw)
            with self.assertRaises(ServiceError) as raised:
                service.approval(run['id'], {'decisao': 'aprovar', 'comentario': 'Ainda há outro bloqueio'}, ACTOR)
            self.assertEqual(raised.exception.code, 'OPEN_BLOCKERS')
            excluded = service.decision(run['id'], group['id'], {'acao': 'excluir', 'justificativa': 'Manter grupo fora do lote'}, ACTOR)
            self.assertTrue(excluded['decision']['already_excluded'])
            self.assertEqual(service.approval_summary(run['id'])['batch'], before['batch'])
            service.approval(run['id'], {'decisao': 'reprovar', 'comentario': 'Encerrar execução de teste'}, ACTOR)
            next_run = start()
            fresh = self.group(service.exceptions(next_run['id'], {'page_size': 500})['items'])
            self.assertEqual(fresh['id'], group['id'])
            self.assertEqual(fresh['status'], 'open')
            self.assertIsNone(fresh.get('decision'))
            historical = self.group(service.exceptions(run['id'], {'page_size': 500})['items'])
            self.assertEqual(historical['status'], 'excluded')
            self.assertEqual(ledger.read_bytes(), raw)


if __name__ == '__main__':
    unittest.main()
