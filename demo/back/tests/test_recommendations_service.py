"""Recommendations preserve evidence, review boundaries, atomicity and history."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from src.api.app import create_app
from src.pipeline.service import PipelineService, ServiceError

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data' / 'case'
ACTOR = 'Revisor das recomendações'


def await_review(service, ident):
    until = time.monotonic() + 30
    while time.monotonic() < until:
        run = service.get_run(ident)
        if run['status'] == 'awaiting_approval':
            return run
        if run['status'] == 'failed':
            raise AssertionError(run.get('error'))
        time.sleep(.02)
    raise AssertionError('A execução não chegou à revisão em 30 segundos.')


class RecommendationsServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tarvo-recommendations-')
        self.base = Path(self.temp.name)
        self.service = PipelineService(self.base / 'workflow.sqlite3', SOURCE, self.base / 'runs')
        self.run = await_review(self.service, self.service.start_run({'competencia': '2026-09'}, ACTOR)['id'])
        self.ident = self.run['id']

    def tearDown(self):
        self.service.close()
        self.temp.cleanup()

    def assert_error(self, code, operation):
        with self.assertRaises(ServiceError) as raised:
            operation()
        self.assertEqual(raised.exception.code, code)

    def test_preview_is_frozen_and_reads_never_call_the_current_policy(self):
        original = self.service.recommendations(self.ident)
        self.assertEqual(original['snapshot_status'], 'captured')
        self.assertTrue(original['assumptions'])
        self.assertGreater(original['summary']['eligible'], 0)
        with (patch('src.pipeline.service.capture_assumptions', side_effect=AssertionError('Não reler hipóteses')),
              patch('src.pipeline.service.build_recommendations', side_effect=AssertionError('Não reinterpretar'))):
            repeated = self.service.recommendations(self.ident)
        self.assertEqual(original, repeated)
        self.assertEqual(original['assumptions'], self.run['snapshot']['assumptions'])
        for item in original['recommendations']:
            if item['eligible']:
                self.assertIn(item['kind'], ('DIVERGENCIA_TAXA', 'DUPLICIDADE'))
                self.assertNotEqual(item['severity'], 'bloqueante')
                self.assertTrue(item['evidence'])
                self.assertEqual(item['suggested_action'], 'accept')

    def test_apply_accepts_only_eligible_and_preserves_money_blockers_and_approval(self):
        preview = self.service.recommendations(self.ident)
        expected = {item['exception_id'] for item in preview['recommendations'] if item['eligible']}
        before = self.service.approval_summary(self.ident)
        hashes = {name: hashlib.sha256(Path(meta['path']).read_bytes()).hexdigest() for name, meta in self.run['datasets'].items()}
        receipt = self.service.apply_recommendations(self.ident, preview['preview_token'], ACTOR)
        self.assertEqual(set(receipt['exception_ids']), expected)
        self.assertEqual(receipt['applied'], len(expected))
        self.assertFalse(receipt['already_applied'])
        after = self.service.approval_summary(self.ident)
        self.assertEqual(after['batch'], before['batch'])
        self.assertEqual(after['open_blocking'], before['open_blocking'])
        self.assertEqual(self.service.get_run(self.ident)['status'], 'awaiting_approval')
        self.assertIsNone(self.service.get_run(self.ident)['approval'])
        self.assertFalse(self.service.get_run(self.ident)['exports'])
        self.assertEqual(hashes, {name: hashlib.sha256(Path(meta['path']).read_bytes()).hexdigest() for name, meta in self.run['datasets'].items()})
        issues = self.service._exceptions(self.ident)
        self.assertEqual({item['id'] for item in issues if item['decision']}, expected)
        for item in issues:
            if item['id'] in expected:
                self.assertEqual(item['decision']['acao'], 'aceitar')
                self.assertIn('Encaminhamento PENDENTE:', item['decision']['justificativa'])
                self.assertEqual(item['decision']['recommendation']['follow_up_status'], 'pending')
                self.assertEqual(item['decision']['follow_up_status'], 'pending')
                self.assertTrue(item['decision']['follow_up'])
                self.assertTrue(item['decision']['recommendation']['evidence'])
        self.assert_error('OPEN_BLOCKERS', lambda: self.service.approval(self.ident, {'decisao': 'aprovar', 'comentario': 'Ainda há bloqueantes'}, ACTOR))

    def test_receipt_is_idempotent_across_restarts_and_does_not_duplicate_audit(self):
        token = self.service.recommendations(self.ident)['preview_token']
        first = self.service.apply_recommendations(self.ident, token, ACTOR)
        count = self.service.db.execute('SELECT count(*) FROM wf_decisions').fetchone()[0]
        audit = self.service.audit(self.ident)['records']
        self.service.close()
        self.service = PipelineService(self.base / 'workflow.sqlite3', SOURCE, self.base / 'runs')
        second = self.service.apply_recommendations(self.ident, token, 'Outro revisor')
        self.assertTrue(second['already_applied'])
        self.assertEqual(second['actor'], first['actor'])
        self.assertEqual(second['exception_ids'], first['exception_ids'])
        self.assertEqual(count, self.service.db.execute('SELECT count(*) FROM wf_decisions').fetchone()[0])
        self.assertEqual(audit, self.service.audit(self.ident)['records'])
        self.assert_error('NO_ELIGIBLE_RECOMMENDATIONS', lambda: self.service.apply_recommendations(self.ident, self.service.recommendations(self.ident)['preview_token'], ACTOR))

    def test_manual_decision_invalidates_preview_and_is_never_overwritten(self):
        preview = self.service.recommendations(self.ident)
        item = next(item for item in preview['recommendations'] if item['eligible'])
        manual = self.service.decision(self.ident, item['exception_id'], {'acao': 'aceitar', 'justificativa': 'Revisão individual confirmada'}, ACTOR)
        self.assert_error('STALE_RECOMMENDATIONS', lambda: self.service.apply_recommendations(self.ident, preview['preview_token'], ACTOR))
        fresh = self.service.recommendations(self.ident)
        self.assertNotEqual(fresh['preview_token'], preview['preview_token'])
        self.assertFalse(next(row for row in fresh['recommendations'] if row['id'] == item['id'])['eligible'])
        self.service.apply_recommendations(self.ident, fresh['preview_token'], ACTOR)
        self.assertEqual(next(row for row in self.service._exceptions(self.ident) if row['id'] == item['id']), manual)

    def test_failure_partway_through_batch_rolls_back_every_decision_and_audit(self):
        preview = self.service.recommendations(self.ident)
        self.assertGreater(preview['summary']['eligible'], 1)
        original = self.service.decision
        calls = []
        def failing(*args, **kwargs):
            calls.append(args[1])
            if len(calls) == 2:
                raise ServiceError(409, 'SIMULATED_FAILURE', 'Falha durante o lote')
            return original(*args, **kwargs)
        before_issues = self.service._exceptions(self.ident)
        before_audit = self.service.audit(self.ident)['records']
        with patch.object(self.service, 'decision', side_effect=failing):
            self.assert_error('SIMULATED_FAILURE', lambda: self.service.apply_recommendations(self.ident, preview['preview_token'], ACTOR))
        self.assertEqual(self.service._exceptions(self.ident), before_issues)
        self.assertEqual(self.service.audit(self.ident)['records'], before_audit)
        self.assertEqual(self.service.db.execute('SELECT count(*) FROM wf_recommendation_batches').fetchone()[0], 0)

    def test_legacy_reads_are_empty_and_do_not_create_historical_recommendations(self):
        original = self.service._run
        def legacy(ident):
            run = original(ident)
            run.pop('recommendation_snapshot', None)
            run['snapshot'].pop('assumptions', None)
            return run
        before = self.service.db.execute('SELECT data FROM wf_runs WHERE id=?', (self.ident,)).fetchone()[0]
        with patch.object(self.service, '_run', side_effect=legacy), patch('src.pipeline.service.build_recommendations', side_effect=AssertionError('Não reinterpretar legado')):
            preview = self.service.recommendations(self.ident)
            self.assertEqual(preview['snapshot_status'], 'legacy_unavailable')
            self.assertFalse(preview['can_apply'])
            self.assertEqual(preview['assumptions'], [])
            self.assertEqual(preview['recommendations'], [])
            self.assertTrue(preview['warning'])
            self.assert_error('RECOMMENDATIONS_UNAVAILABLE', lambda: self.service.apply_recommendations(self.ident, 'a' * 64, ACTOR))
        self.assertEqual(before, self.service.db.execute('SELECT data FROM wf_runs WHERE id=?', (self.ident,)).fetchone()[0])

    def test_changed_evidence_or_recommendation_file_cannot_be_applied(self):
        preview = self.service.recommendations(self.ident)
        source = Path(self.run['snapshot']['sources'][0]['snapshot_path'])
        original = source.read_bytes()
        source.chmod(0o644)
        source.write_bytes(b'alterado')
        self.assert_error('INPUT_CHANGED', lambda: self.service.apply_recommendations(self.ident, preview['preview_token'], ACTOR))
        source.write_bytes(original)
        source.chmod(0o444)
        frozen = Path(self.run['recommendation_snapshot']['path'])
        frozen.chmod(0o644)
        frozen.write_text('{}')
        self.assert_error('RECOMMENDATIONS_CHANGED', lambda: self.service.apply_recommendations(self.ident, preview['preview_token'], ACTOR))
        self.assertEqual(self.service.db.execute('SELECT count(*) FROM wf_decisions').fetchone()[0], 0)

    def test_rejected_run_cannot_apply_and_token_is_scoped_to_run(self):
        preview = self.service.recommendations(self.ident)
        other = await_review(self.service, self.service.start_run({'competencia': '2026-09'}, ACTOR)['id'])
        self.assert_error('STALE_RECOMMENDATIONS', lambda: self.service.apply_recommendations(other['id'], preview['preview_token'], ACTOR))
        self.service.approval(self.ident, {'decisao': 'reprovar', 'comentario': 'Aguardar documentos'}, ACTOR)
        self.assertFalse(self.service.recommendations(self.ident)['can_apply'])
        self.assert_error('RUN_NOT_REVIEWABLE', lambda: self.service.apply_recommendations(self.ident, preview['preview_token'], ACTOR))

    def test_code_change_invalidates_application_without_recording_decisions(self):
        preview = self.service.recommendations(self.ident)
        changed = {**self.service._code_snapshot(), 'content_hash': 'changed'}
        with patch.object(self.service, '_code_snapshot', return_value=changed):
            self.assert_error('CODE_CHANGED', lambda: self.service.apply_recommendations(self.ident, preview['preview_token'], ACTOR))
        self.assertEqual(self.service.db.execute('SELECT count(*) FROM wf_decisions').fetchone()[0], 0)

    def test_unbalanced_batch_is_visible_but_cannot_apply_recommendations(self):
        summary = self.service.approval_summary(self.ident)
        summary['batch'].update(balanced=False, credit_brl='0.00')
        with patch.object(self.service, 'approval_summary', return_value=summary):
            preview = self.service.recommendations(self.ident)
            self.assertGreater(preview['summary']['eligible'], 0)
            self.assertFalse(preview['can_apply'])
            self.assertTrue(preview['warning'])
            self.assert_error('UNBALANCED_RECOMMENDATION_BATCH', lambda: self.service.apply_recommendations(self.ident, preview['preview_token'], ACTOR))
        self.assertEqual(self.service.db.execute('SELECT count(*) FROM wf_decisions').fetchone()[0], 0)

    def test_draft_preserves_guidance_but_does_not_offer_application(self):
        ident = self.service.start_run({'competencia': '2026-09', 'draft': True}, ACTOR)['id']
        until = time.monotonic() + 30
        while time.monotonic() < until:
            run = self.service.get_run(ident)
            if run['status'] in ('done', 'failed'):
                break
            time.sleep(.02)
        self.assertEqual(run['status'], 'done', run)
        preview = self.service.recommendations(ident)
        self.assertEqual(preview['snapshot_status'], 'captured')
        self.assertTrue(preview['recommendations'])
        self.assertTrue(preview['assumptions'])
        self.assertFalse(preview['can_apply'])
        self.assertEqual(preview['summary']['eligible'], 0)
        self.assert_error('RUN_NOT_REVIEWABLE', lambda: self.service.apply_recommendations(ident, preview['preview_token'], ACTOR))


class RecommendationsHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tarvo-recommendations-api-')
        self.base = Path(self.temp.name)
        self.app = create_app(self.base / 'state.sqlite3', SOURCE, self.base / 'runs', mail_private_dir=self.base / 'private')
        self.context = TestClient(self.app, base_url='http://127.0.0.1')
        self.client = self.context.__enter__()
        self.headers = {'X-User': 'Revisor API'}
        response = self.client.post('/api/runs', headers=self.headers, json={'pipeline_id': 'fechamento-tarvo', 'competencia': '2026-09'})
        self.assertEqual(response.status_code, 202, response.text)
        self.ident = response.json()['id']
        self.run = await_review(self.app.state.workflow, self.ident)

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.temp.cleanup()

    def test_api_requires_actor_and_exact_review_token_then_returns_receipt(self):
        path = f'/api/runs/{self.ident}/recommendations'
        preview = self.client.get(path)
        self.assertEqual(preview.status_code, 200, preview.text)
        payload = {'preview_token': preview.json()['preview_token']}
        self.assertEqual(self.client.post(path + '/apply', json=payload).status_code, 422)
        self.assertEqual(self.client.post(path + '/apply', headers=self.headers, json={**payload, 'acao': 'excluir'}).status_code, 422)
        response = self.client.post(path + '/apply', headers=self.headers, json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertGreater(response.json()['applied'], 0)
        replay = self.client.post(path + '/apply', headers=self.headers, json=payload)
        self.assertTrue(replay.json()['already_applied'])
        self.assertEqual(self.client.get(path).json()['summary']['eligible'], 0)
        conference = self.client.get('/api/state', params={'comp': '2026-09', 'run_id': self.ident}).json()
        applied_ids = set(response.json()['exception_ids'])
        reviewed = [item for item in conference['results']['pendencias'] if item['id_saida'] in applied_ids]
        self.assertTrue(reviewed)
        self.assertTrue(all(item['review_status'] == 'accepted' and item['operational_status'] == 'pending' for item in reviewed))

    def test_conference_uses_run_assumptions_and_reports_missing_historical_snapshot(self):
        params = {'comp': '2026-09', 'run_id': self.ident}
        state = self.client.get('/api/state', params=params).json()
        self.assertEqual(state['assumptions'], self.run['snapshot']['assumptions'])
        original = self.app.state.workflow.get_run
        def legacy(ident):
            run = deepcopy(original(ident))
            run['snapshot'].pop('assumptions', None)
            return run
        with patch.object(self.app.state.workflow, 'get_run', side_effect=legacy):
            historical = self.client.get('/api/state', params=params).json()
        self.assertEqual(historical['assumptions'], [])
        self.assertEqual(historical['assumptions_snapshot_status'], 'legacy_unavailable')
        self.assertTrue(any(item['output'] == 'assumptions' for item in historical['limitations']))


if __name__ == '__main__':
    unittest.main()
