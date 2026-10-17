"""Real workflow integration: immutable Parquet, approval, accounting, and restart."""
from copy import deepcopy
import csv
from decimal import Decimal
import hashlib
from io import BytesIO, StringIO
import json
import shutil
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from src.pipeline.service import PipelineService, ServiceError
from src.pipeline.datasets import read_dataset

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data' / 'case'
ACTOR = 'Analista do workflow'


class PipelineServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tarvo-workflow-tests-')
        self.base = Path(self.temp.name)
        self.db = self.base / 'workflow.sqlite3'
        self.runs = self.base / 'runs'
        # Isolate next-month folder discovery from packs that exist in the repository.
        packs_root = patch('src.pipeline.service.PACKS_ROOT', self.base)
        packs_root.start()
        self.addCleanup(packs_root.stop)
        self.service = PipelineService(self.db, SOURCE, self.runs)

    def tearDown(self):
        self.service.close()
        self.temp.cleanup()

    def wait(self, ident, states=('awaiting_approval', 'done', 'failed', 'rejected')):
        until = time.monotonic() + 30
        while time.monotonic() < until:
            run = self.service.get_run(ident)
            if run['status'] in states:
                self.assertNotEqual(run['status'], 'failed', json.dumps(run.get('error'), ensure_ascii=False))
                return run
            time.sleep(.02)
        self.fail('Worker não alcançou estado esperado em 30s.')

    def start(self, **fields):
        run = self.service.start_run({'pipeline_id': 'fechamento-tarvo', 'competencia': '2026-09', **fields}, ACTOR)
        return self.wait(run['run_id'])

    def accept_blockers(self, ident):
        rows = self.service.exceptions(ident, {'page_size': 500})['items']
        for item in rows:
            if item['severidade'] == 'bloqueante' and item['status'] == 'open':
                self.service.decision(ident, item['id'], {'acao': 'aceitar', 'justificativa': 'Encaminhamento documentado na verificação'}, ACTOR)

    def approve(self, ident):
        self.accept_blockers(ident)
        self.service.approval(ident, {'decisao': 'aprovar', 'comentario': 'Lote e ressalvas revisados no teste'}, ACTOR)
        return self.wait(ident, ('done', 'failed'))

    def assert_error(self, status, code, call):
        with self.assertRaises(ServiceError) as raised: call()
        self.assertEqual(raised.exception.status, status)
        self.assertEqual(raised.exception.code, code)

    def test_changed_disk_code_requires_process_restart_before_new_run(self):
        original = self.service._code_snapshot()
        changed = deepcopy(original)
        changed['content_hash'] = 'different-code-from-disk'
        # Simulates an edited source tree without mutating shared production files.
        with patch.object(PipelineService, '_code_snapshot', return_value=changed), patch('src.pipeline.service.execute_step') as execute:
            self.assert_error(409, 'CODE_RESTART_REQUIRED', lambda: self.service.start_run({'competencia': '2026-09'}, ACTOR))
            self.assertFalse(self.service.list_runs())
            self.assertFalse(list(self.runs.glob('run-*')))
            # Constructing a new instance is not a restart of the Python process.
            same_process = PipelineService(self.base / 'second.sqlite3', SOURCE, self.base / 'second-runs')
            try:
                self.assertEqual(same_process.loaded_code_hash, self.service.loaded_code_hash)
                self.assert_error(409, 'CODE_RESTART_REQUIRED', lambda: same_process.start_run({'competencia': '2026-09'}, ACTOR))
                self.assertFalse(same_process.list_runs())
            finally:
                same_process.close()
            execute.assert_not_called()
        self.assertEqual(self.service._code_snapshot(), original)
        run = self.start()
        self.assertEqual(run['snapshot']['loaded_code_hash'], run['snapshot']['code']['content_hash'])
        self.accept_blockers(run['id'])
        with patch.object(self.service, '_code_snapshot', return_value=changed):
            self.assert_error(409, 'CODE_CHANGED', lambda: self.service.approval(run['id'], {'decisao': 'aprovar', 'comentario': 'Código da execução antiga mudou'}, ACTOR))
        self.assertEqual(self.service.get_run(run['id'])['status'], 'awaiting_approval')

    def test_pipeline_versions_are_immutable_and_metadata_round_trips(self):
        first = self.service.get_pipeline('fechamento-tarvo')
        newer = self.service.save_pipeline('fechamento-tarvo', first, ACTOR)
        self.assertEqual(newer['version'], first['version'] + 1)
        self.assertEqual(self.service.get_pipeline('fechamento-tarvo', first['version']), first)
        self.assertEqual(len(self.service.versions('fechamento-tarvo')), 2)
        invalid = deepcopy(first)
        invalid['steps'] = [s for s in invalid['steps'] if s['type'] != 'aprovacao']
        self.assertFalse(self.service.validate_pipeline(first['id'], invalid)['valid'])
        self.assert_error(422, 'INVALID_PIPELINE', lambda: self.service.save_pipeline(first['id'], invalid, ACTOR))
        self.assertEqual(len(self.service.versions('fechamento-tarvo')), 2)

    def test_upload_validation_missing_duplicate_sources_and_period_mismatch(self):
        path = SOURCE / '01_orbe_relatorio_comissoes_set2026.csv'
        raw = path.read_bytes()
        self.assert_error(422, 'INVALID_FILENAME', lambda: self.service.upload_file('../' + path.name, raw, ACTOR))
        first = self.service.upload_file(path.name, raw, ACTOR)
        second = self.service.upload_file(path.name, raw, ACTOR)
        self.assertNotEqual(first['file_id'], second['file_id'])
        self.assertEqual(first['sha256'], hashlib.sha256(raw).hexdigest())
        self.assert_error(422, 'REQUIRED_SOURCES', lambda: self.service.start_run({'competencia': '2026-09', 'file_ids': [first['id'], second['id']]}, ACTOR))
        self.assert_error(422, 'INVALID_FILE_SELECTION', lambda: self.service.start_run({'competencia': '2026-09', 'file_ids': [{}]}, ACTOR))
        self.assert_error(422, 'PERIOD_WITHOUT_INPUTS', lambda: self.service.start_run({'competencia': '2026-10'}, ACTOR))
        self.assertFalse(self.service.list_runs())

    def test_next_month_folder_discovery_rejects_ambiguity_and_explicit_source_wins(self):
        self.service.close()
        default = self.base / 'configured' / 'case'
        shutil.copytree(SOURCE, default)
        self.service = PipelineService(self.db, default, self.runs)
        october = default.parent / 'Tarvo_Data_Pack_2026-10'
        shutil.copytree(SOURCE, october)
        orbe = october / '01_orbe_relatorio_comissoes_set2026.csv'
        orbe.write_text(orbe.read_text().replace('/09/2026', '/10/2026'))
        created = self.service.start_run({'competencia': '2026-10'}, ACTOR)
        run = self.wait(created['id'])
        self.assertTrue(all(Path(s['original_path']).parent == october.resolve() for s in run['snapshot']['sources']))
        self.service.approval(run['id'], {'decisao': 'reprovar', 'comentario': 'Encerrar fixture de outubro'}, ACTOR)
        ambiguous = default.parent / 'Tarvo_Data_Pack_out2026'
        shutil.copytree(october, ambiguous)
        self.assert_error(422, 'SOURCE_DIRECTORY_AMBIGUOUS', lambda: self.service.start_run({'competencia': '2026-10'}, ACTOR))
        explicit = self.service.start_run({'competencia': '2026-10', 'source_dir': str(october)}, ACTOR)
        self.assertEqual(self.wait(explicit['id'])['status'], 'awaiting_approval')

    def test_real_pause_concurrency_gate_events_and_source_snapshots(self):
        run = self.start()
        ident = run['id']
        self.assertEqual(run['status'], 'awaiting_approval')
        self.assertGreater(run['blocking_open'], 0)
        self.assertFalse(run['exports'])
        approval = next(s for s in run['steps'] if s['type'] == 'aprovacao')
        self.assertEqual(approval['status'], 'running')
        self.assertIn('aprovacao_pendente', approval['datasets'])
        for source in run['snapshot']['sources']:
            self.assertEqual(hashlib.sha256(Path(source['snapshot_path']).read_bytes()).hexdigest(), source['sha256'])
            self.assertEqual(hashlib.sha256(Path(source['original_path']).read_bytes()).hexdigest(), source['sha256'])
            self.assertIn('rows_read', source)
            self.assertIn('rows_discarded', source)
            self.assertNotEqual(source['original_path'], source['snapshot_path'])
        self.assert_error(409, 'PERIOD_BUSY', lambda: self.service.start_run({'competencia': '2026-09'}, ACTOR))
        self.assert_error(409, 'EXPORT_NOT_APPROVED', lambda: self.service.export(ident))
        self.assert_error(422, 'OPEN_BLOCKERS', lambda: self.service.approval(ident, {'decisao': 'aprovar', 'comentario': 'Tentativa sem revisar'}, ACTOR))
        events = self.service.events(ident)
        self.assertIn('awaiting_approval', {e['type'] for e in events})
        self.assertIn('step_progress', {e['type'] for e in events})
        midpoint = events[len(events) // 2]['id']
        self.assertEqual(self.service.events(ident, midpoint), [e for e in events if e['id'] > midpoint])

    def test_rejection_archives_run_and_cannot_export_or_edit_decisions(self):
        run = self.start()
        issue = self.service.exceptions(run['id'])['items'][0]
        self.service.approval(run['id'], {'decisao': 'reprovar', 'comentario': 'Documentação ainda pendente'}, ACTOR)
        self.assertEqual(self.service.get_run(run['id'])['status'], 'rejected')
        self.assert_error(409, 'EXPORT_NOT_APPROVED', lambda: self.service.export(run['id']))
        self.assert_error(409, 'RUN_NOT_REVIEWABLE', lambda: self.service.decision(run['id'], issue['id'], {'acao': 'aceitar', 'justificativa': 'Tarde demais'}, ACTOR))
        another = self.start()
        self.assertNotEqual(another['id'], run['id'])
        self.assertEqual(self.service.get_run(run['id'])['status'], 'rejected')

    def test_approved_export_balances_and_two_runs_have_identical_content_hashes(self):
        first = self.approve(self.start()['id'])
        first_hashes = {name: item['sha256'] for name, item in first['datasets'].items()}
        first_files = {f['name']: f['sha256'] for f in first['exports'] if f.get('reproducible') is not False}
        second = self.approve(self.start()['id'])
        self.assertEqual(first_hashes, {name: item['sha256'] for name, item in second['datasets'].items()})
        self.assertEqual(first_files, {f['name']: f['sha256'] for f in second['exports'] if f.get('reproducible') is not False})
        with ZipFile(BytesIO(self.service.export(second['id']))) as archive:
            self.assertEqual(set(archive.namelist()), {'lancamentos_fenix.csv', 'relatorio_excecoes.csv', 'ajustes.csv', 'auditoria.json'})
            ledger = list(csv.DictReader(StringIO(archive.read('lancamentos_fenix.csv').decode()), delimiter=';'))
            debit = sum((Decimal(r['debito']) for r in ledger), Decimal(0))
            credit = sum((Decimal(r['credito']) for r in ledger), Decimal(0))
            self.assertEqual(debit, credit)
            accounts = {r['code'] for r in read_dataset(second['datasets']['accounts']['path']) if r['postable']}
            self.assertTrue(all(r['conta_codigo'] in accounts for r in ledger))
            audit = json.loads(archive.read('auditoria.json'))
            self.assertEqual(audit['approval']['actor'], ACTOR)
            self.assertTrue(any(a['action'] == 'approval_decision' for a in audit['records']))
            self.assertTrue(audit['reproducibility']['content_hashes'])
        self.assertEqual(self.service.export(second['id']), self.service.export(second['id']))

    def test_paused_run_resumes_after_restart_without_recalculating_completed_steps(self):
        run = self.start()
        ident = run['id']
        self.accept_blockers(ident)
        hashes = {k: v['sha256'] for k, v in run['datasets'].items()}
        self.service.close()
        self.service = PipelineService(self.db, SOURCE, self.runs)
        self.assertEqual(self.service.get_run(ident)['status'], 'awaiting_approval')
        from src.pipeline.service import execute_step
        with patch('src.pipeline.service.execute_step', wraps=execute_step) as execution:
            finished = self.approve(ident)
            self.assertEqual([call.args[0] for call in execution.call_args_list], ['exportar_erp'])
        self.assertTrue(all(finished['datasets'][k]['sha256'] == value for k, value in hashes.items()))
        self.assertEqual(finished['status'], 'done')

    def test_restart_marks_interrupted_run_failed_instead_of_leaving_lock_forever(self):
        run = self.start()
        # Simulates persisted state at process death; there is no worker for this paused run.
        with self.service.lock, self.service.db:
            crashed = self.service._run(run['id'])
            crashed['status'] = 'running'
            self.service._save_run(crashed)
        self.service.close()
        self.service = PipelineService(self.db, SOURCE, self.runs)
        failed = self.service.get_run(run['id'])
        self.assertEqual(failed['status'], 'failed')
        self.assertEqual(failed['error']['code'], 'EXECUTION_INTERRUPTED')
        self.assertTrue(any(a['action'] == 'execution_interrupted' for a in self.service.audit(run['id'])['records']))
        self.assertEqual(self.start()['status'], 'awaiting_approval')

    def test_preview_reads_immutable_output_and_never_reexecutes_pipeline(self):
        run = self.start()
        step = next(s for s in run['steps'] if s['type'] == 'conferir_mdr')
        before = {m['path']: hashlib.sha256(Path(m['path']).read_bytes()).hexdigest() for m in step['outputs']}
        with patch('src.pipeline.service.execute_step', side_effect=AssertionError('Preview não pode executar regra')):
            result = self.service.preview(run['id'], step['id'], {'page': 1, 'page_size': 7, 'only_exceptions': 'true', 'diff': 'true'})
        self.assertLessEqual(len(result['rows']), 7)
        self.assertGreater(result['total'], 0)
        self.assertTrue(all(r['__exception_ids'] for r in result['rows']))
        self.assertTrue(any(c['new'] for c in result['schema']))
        self.assertIn('new_columns', result['diff'])
        self.assertEqual(before, {path: hashlib.sha256(Path(path).read_bytes()).hexdigest() for path in before})
        self.assert_error(422, 'INVALID_PREVIEW_QUERY', lambda: self.service.preview(run['id'], step['id'], {'page_size': 501}))

    def test_adjustments_are_validated_and_applied_only_to_export_copy(self):
        run = self.start()
        ident = run['id']
        ledger_meta = run['datasets']['lancamentos']
        before = Path(ledger_meta['path']).read_bytes()
        issues = self.service.exceptions(ident, {'page_size': 500})['items']
        issue = next(e for e in issues if e['tipo'] == 'CREDITO_NAO_IDENTIFICADO')
        self.assert_error(422, 'INVALID_MONEY', lambda: self.service.decision(ident, issue['id'], {'acao': 'ajustar', 'valor': 'NaN', 'justificativa': 'Inválido'}, ACTOR))
        self.assert_error(422, 'INVALID_ACCOUNT', lambda: self.service.decision(ident, issue['id'], {'acao': 'ajustar', 'conta': '1', 'justificativa': 'Conta sintética'}, ACTOR))
        saved = self.service.decision(ident, issue['id'], {'acao': 'ajustar', 'valor': '100.00', 'conta': '1.1.09.002', 'justificativa': 'Correção fictícia documentada no teste'}, ACTOR)
        self.assertEqual(saved['status'], 'adjusted')
        self.assertEqual(Path(ledger_meta['path']).read_bytes(), before)
        finished = self.approve(ident)
        self.assertEqual(Path(ledger_meta['path']).read_bytes(), before)
        self.assertEqual(finished['datasets']['ajustes']['rows'], 1)
        with ZipFile(BytesIO(self.service.export(ident))) as archive:
            exported = list(csv.DictReader(StringIO(archive.read('lancamentos_fenix.csv').decode()), delimiter=';'))
            altered = [r for r in exported if r['entry_id'] == saved['decision']['entry_id']]
            self.assertEqual(len(altered), 2)
            self.assertTrue(all(r['valor'] == '100.00' for r in altered))
            self.assertEqual(sum(Decimal(r['debito']) for r in exported), sum(Decimal(r['credito']) for r in exported))
        decision_audit = next(a for a in self.service.audit(ident)['records'] if a['action'] == 'exception_decision' and a['details']['before']['id'] == issue['id'])
        self.assertEqual(decision_audit['actor'], ACTOR)
        self.assertEqual(decision_audit['details']['before']['status'], 'open')
        self.assertEqual(decision_audit['details']['after']['status'], 'adjusted')

    def test_excluding_already_blocked_origin_is_audited_without_inventing_entry(self):
        run = self.start()
        issue = next(e for e in self.service.exceptions(run['id'], {'page_size': 500})['items'] if 'ATLAS' in e.get('descricao', '').upper() or e['tipo'] == 'VINCULO_NAO_CONFIRMADO')
        excluded = self.service.decision(run['id'], issue['id'], {'acao': 'excluir', 'justificativa': 'Manter Atlas fora até contrato confirmado'}, ACTOR)
        self.assertEqual(excluded['status'], 'excluded')
        self.assertTrue(excluded['decision'].get('already_excluded'))
        self.assertEqual(self.approve(run['id'])['status'], 'done')

    def test_checklist_linked_status_is_derived_and_manual_change_persists(self):
        checklist = self.service.checklist('2026-09')
        manual = next(t for t in checklist['tasks'] if t['manual'])
        linked = next(t for t in checklist['tasks'] if not t['manual'])
        self.assert_error(409, 'DERIVED_TASK', lambda: self.service.update_task(linked['id'], {'status': 'concluida'}, ACTOR))
        self.service.update_task(manual['id'], {'status': 'concluida', 'responsavel': ACTOR, 'comentario': 'Tabela revisada'}, ACTOR)
        run = self.start()
        current = self.service.checklist('2026-09')
        self.assertEqual(current['run_id'], run['id'])
        self.assertEqual(next(t for t in current['tasks'] if t['id'] == manual['id'])['status'], 'concluida')
        self.assertEqual(next(t for t in current['tasks'] if t['step_type'] == 'aprovacao')['status'], 'awaiting_approval')
        self.assertEqual(next(t for t in current['tasks'] if t['step_type'] == 'exportar_erp')['status'], 'pendente')
        october = self.service.checklist('2026-10')
        self.assertTrue(all(t['status'] == 'pendente' for t in october['tasks']))


if __name__ == '__main__':
    unittest.main()
