"""Cross-feature review regressions using a real run and an injected mail transport."""
import hashlib
from pathlib import Path
import tempfile
import time
import unittest

from fastapi.testclient import TestClient

from src.api.app import create_app
from src.mail.auth import AuthManager, GmailSMTPProvider
from tests.test_mail_smtp import SMTPTransport


PACK = Path(__file__).resolve().parents[1] / 'data' / 'case'
MAIL = '/api/mail/suggestions'


class MergedReviewIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tarvo-merged-review-')
        self.base = Path(self.temp.name)
        self.transport = SMTPTransport()
        auth = AuthManager(self.base / 'private', config={},
                           smtp_provider=GmailSMTPProvider(self.transport))
        self.app = create_app(self.base / 'case.sqlite3', PACK, self.base / 'runs', mail_auth=auth)
        self.context = TestClient(self.app, base_url='http://127.0.0.1')
        self.client = self.context.__enter__()
        self.actor = {'X-User': 'Revisao integrada em base temporaria'}

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.temp.cleanup()

    def start(self):
        response = self.client.post('/api/runs', headers=self.actor,
                                    json={'pipeline_id': 'fechamento-tarvo', 'competencia': '2026-09'})
        self.assertEqual(response.status_code, 202, response.text)
        ident = response.json()['run_id']
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            run = self.client.get('/api/runs/' + ident).json()
            self.assertNotEqual(run['status'], 'failed', run)
            if run['status'] == 'awaiting_approval':
                # Suggestions are prepared by a callback after the review transition.
                suggestions = self.client.get(MAIL, params={'run_id': ident}).json()
                if suggestions['suggestions']:
                    return run, suggestions
            time.sleep(.03)
        self.fail('A execução não preparou a revisão e as sugestões em 30 segundos.')

    def test_group_batch_decision_and_recommendations_preserve_mail_and_financial_snapshots(self):
        run, mail = self.start()
        ident = run['id']
        path = '/api/runs/' + ident
        issues = self.client.get(path + '/exceptions', params={'page_size': 500}).json()['exceptions']
        group, = [item for item in issues if item['tipo'] == 'CADASTRO_NAO_CONFIRMADO']
        self.assertEqual(group['group_scope'], 'merchant_period')
        self.assertEqual(group['operation_count'], 57)
        self.assertEqual(len(group['affected_operations']), 57)
        before = self.client.get(path + '/approval-summary').json()
        hashes = {name: hashlib.sha256(Path(meta['path']).read_bytes()).hexdigest()
                  for name, meta in run['datasets'].items()}

        preview = self.client.get(path + '/recommendations').json()
        advice = next(item for item in preview['recommendations'] if item['exception_id'] == group['id'])
        self.assertFalse(advice['eligible'])
        self.assertEqual(advice['suggested_action'], 'wait')
        self.assertEqual(advice['affected_operations'], group['affected_operations'])
        self.assertEqual(advice['operation_count'], 57)
        excluded = next(item for item in mail['summary']['excluded'] if item['id'] == group['id'])
        self.assertEqual(excluded['kind'], 'CADASTRO_NAO_CONFIRMADO')
        self.assertTrue(excluded['reason'])
        self.assertNotIn(group['id'], {item['id'] for suggestion in mail['suggestions'] for item in suggestion['items']})

        eligible = {item['exception_id'] for item in preview['recommendations'] if item['eligible']}
        suggestion = next(item for item in mail['suggestions']
                          if item['kind'] == 'DIVERGENCIA_TAXA'
                          and any(row['id'] in eligible for row in item['items']))
        self.assertFalse(suggestion['stale'])
        saved_attachments = {item['url']: self.client.get(item['url']).content
                             for item in suggestion['attachments']}
        for item in suggestion['attachments']:
            self.assertEqual(hashlib.sha256(saved_attachments[item['url']]).hexdigest(), item['sha256'])

        response = self.client.post(path + '/exceptions/decisions', headers=self.actor, json={
            'ids': [group['id']], 'acao': 'excluir', 'justificativa': 'Aguardar cadastro e contrato; sem faturar.'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['decided'], 1)
        current = self.client.get(path + '/exceptions', params={'page_size': 500}).json()['exceptions']
        decided = next(item for item in current if item['id'] == group['id'])
        self.assertEqual(decided['status'], 'excluded')
        self.assertFalse(decided['decision']['billing_authorized'])
        self.assertTrue(decided['decision']['already_excluded'])
        self.assertEqual(decided['decision']['affected_operations'], group['affected_operations'])
        self.assertEqual(decided['decision']['source_fingerprint'], group['source_fingerprint'])
        # An internal registration decision alone does not change the external contestation.
        self.assertFalse(self.client.get(MAIL + '/' + suggestion['id']).json()['stale'])

        stale = self.client.post(path + '/recommendations/apply', headers=self.actor,
                                 json={'preview_token': preview['preview_token']})
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(stale.json()['error']['code'], 'STALE_RECOMMENDATIONS')
        fresh = self.client.get(path + '/recommendations').json()
        advice = next(item for item in fresh['recommendations'] if item['exception_id'] == group['id'])
        self.assertEqual(advice['status'], 'decided')
        self.assertFalse(advice['eligible'])
        applied = self.client.post(path + '/recommendations/apply', headers=self.actor,
                                   json={'preview_token': fresh['preview_token']})
        self.assertEqual(applied.status_code, 200, applied.text)
        self.assertEqual(set(applied.json()['exception_ids']), eligible)
        self.assertNotIn(group['id'], applied.json()['exception_ids'])

        historical = self.client.get(MAIL + '/' + suggestion['id']).json()
        self.assertTrue(historical['stale'])
        self.assertIn('SUGGESTION_EVIDENCE_CHANGED', {item['code'] for item in historical['blockers']})
        for key in ('version', 'content_hash', 'evidence_hash', 'items', 'attachments'):
            self.assertEqual(historical[key], suggestion[key], key)
        for url, content in saved_attachments.items():
            self.assertEqual(self.client.get(url).content, content)
        after = self.client.get(path + '/approval-summary').json()
        self.assertEqual(after['open_blocking'], before['open_blocking'] - 1)
        self.assertEqual(after['batch'], before['batch'])
        self.assertEqual(hashes, {name: hashlib.sha256(Path(meta['path']).read_bytes()).hexdigest()
                                  for name, meta in run['datasets'].items()})
        final_run = self.client.get(path).json()
        self.assertEqual(final_run['status'], 'awaiting_approval')
        self.assertIsNone(final_run['approval'])
        self.assertEqual(final_run['exports'], [])
        self.assertEqual(self.transport.count('data'), 0)


if __name__ == '__main__':
    unittest.main()
