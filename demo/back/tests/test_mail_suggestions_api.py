"""Run-scoped suggestions require a reviewed permission; SMTP is always injected.

These checks exercise the real pipeline, SQLite, API, attachments and MIME. They
prove when a transport would be called, never delivery to a real Gmail inbox.
"""
import copy
from email import policy
from email.parser import BytesParser
import hashlib
from pathlib import Path
import tempfile
import time
import unittest

from fastapi.testclient import TestClient

from src.api.app import create_app
from src.mail.auth import AuthManager, GmailSMTPProvider
from src.store import ROOT
from test_mail_smtp import SMTPTransport


EMAIL = 'financeirotarvo@gmail.com'
PASSWORD = 'abcdefghijklmnop'
BASE = '/api/mail/suggestions'


class SuggestionHTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.transport = SMTPTransport()
        self.auth = AuthManager(self.base / 'private', config={},
                                smtp_provider=GmailSMTPProvider(self.transport))
        self.app = create_app(self.base / 'case.sqlite3', ROOT / 'data/case',
                              self.base / 'runs', mail_auth=self.auth)
        self.context = TestClient(self.app, base_url='http://127.0.0.1')
        self.client = self.context.__enter__()
        self.actor = {'X-User': 'Analista de teste das sugestoes'}
        self.headers = self.actor.copy()

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.tmp.cleanup()

    def login(self):
        response = self.client.post('/api/mail/smtp/connect',
                                    json={'email': EMAIL, 'app_password': PASSWORD})
        self.assertEqual(response.status_code, 200, response.text)
        self.headers = {**self.actor, 'X-CSRF-Token': response.json()['csrf_token']}

    def suggestions(self, run_id):
        response = self.client.get(BASE, params={'run_id': run_id})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertIsInstance(body['summary'], dict)
        return body['suggestions']

    def start(self, *, draft=False):
        response = self.client.post('/api/runs', headers=self.actor, json={
            'pipeline_id': 'fechamento-tarvo', 'competencia': '2026-09', 'draft': draft})
        self.assertEqual(response.status_code, 202, response.text)
        run_id = response.json()['run_id']
        deadline = time.monotonic() + 30
        state = None
        while time.monotonic() < deadline:
            state = self.client.get('/api/runs/' + run_id).json()
            if state['status'] == 'failed':
                self.fail('A execução falhou: ' + str(state))
            if state['status'] in ('awaiting_approval', 'done'):
                # The callback runs after the committed workflow transition.
                records = self.suggestions(run_id)
                if records:
                    self.assertEqual(state['status'], 'done' if draft else 'awaiting_approval')
                    return run_id, records
            time.sleep(.03)
        self.fail('A execução não preparou sugestões automaticamente em 30 segundos: ' + str(state))

    def get(self, ident):
        response = self.client.get(BASE + '/' + ident)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def save_for_review(self, suggestion, **changes):
        response = self.client.put(BASE + '/' + suggestion['id'], headers=self.actor, json={
            'version': suggestion['version'], 'to': EMAIL,
            'subject': suggestion['subject'], 'body': suggestion['body'], **changes})
        self.assertEqual(response.status_code, 200, response.text)
        # Approval uses the saved version fetched for review, not a hidden edit.
        reviewed = self.get(suggestion['id'])
        self.assertEqual(reviewed['version'], response.json()['version'])
        self.assertEqual(reviewed['content_hash'], response.json()['content_hash'])
        self.assertEqual(reviewed['sender']['email'], EMAIL)
        return reviewed

    def approve(self, suggestion, *, headers=None, payload=None):
        if payload is None:
            payload = {'version': suggestion['version'],
                       'content_hash': suggestion['content_hash'], 'permission': True}
        return self.client.post(BASE + '/' + suggestion['id'] + '/approve-send',
                                headers=self.headers if headers is None else headers,
                                json=payload)

    def pick_group(self, records):
        return next(row for row in records if row['kind'] == 'DIVERGENCIA_TAXA'
                    and row['counterparty'] == 'orbe')

    def test_runs_and_tests_prepare_justified_groups_without_sending_and_prepare_is_idempotent(self):
        self.login()
        for draft in (False, True):
            run_id, records = self.start(draft=draft)
            keys = [(row['counterparty'], row['period'], row['kind']) for row in records]
            self.assertEqual(len(keys), len(set(keys)))
            self.assertTrue(any(row['item_count'] > 1 for row in records))
            for row in records:
                self.assertEqual(row['run_id'], run_id)
                self.assertEqual(row['period'], '2026-09')
                self.assertEqual(row['status'], 'suggested')
                self.assertTrue(row['justification'].strip())
                self.assertTrue(row['recommended_action'].strip())
                self.assertEqual(row['item_count'], len(row['items']))
                self.assertTrue(all(item['reason'].strip() for item in row['items']))
                self.assertTrue(row['attachments'])
            versions = {row['id']: (row['version'], row['content_hash']) for row in records}
            response = self.client.post(BASE + '/prepare', headers=self.actor, json={'run_id': run_id})
            self.assertIn(response.status_code, (200, 201), response.text)
            self.assertEqual({row['id']: (row['version'], row['content_hash'])
                              for row in self.suggestions(run_id)}, versions)
        available = self.client.get(BASE + '/runs')
        self.assertEqual(available.status_code, 200, available.text)
        self.assertTrue(any(row['id'] == run_id for row in available.json()['runs']))
        self.assertEqual(self.transport.count('data'), 0)

    def test_login_csrf_actor_and_exact_boolean_permission_are_required_before_transport(self):
        _, records = self.start()
        suggestion = self.pick_group(records)
        self.assertEqual(self.approve(suggestion).status_code, 401)
        self.login()
        reviewed = self.save_for_review(suggestion)
        self.assertEqual(self.approve(reviewed, headers=self.actor).status_code, 403)
        self.assertEqual(self.approve(reviewed, headers={'X-CSRF-Token': self.headers['X-CSRF-Token']}).status_code, 422)
        payload = {'version': reviewed['version'], 'content_hash': reviewed['content_hash']}
        self.assertEqual(self.approve(reviewed, payload=payload).status_code, 422)
        for permission in (False, 1, 'true', None):
            with self.subTest(permission=permission):
                response = self.approve(reviewed, payload={**payload, 'permission': permission})
                self.assertEqual(response.status_code, 422, response.text)
        stale_hash = {**payload, 'content_hash': '0' * 64, 'permission': True}
        self.assertEqual(self.approve(reviewed, payload=stale_hash).status_code, 409)
        self.assertEqual(self.approve(suggestion).status_code, 409)
        self.assertEqual(self.transport.count('data'), 0)

    def test_explicit_permission_sends_exact_reviewed_mime_once_with_scoped_attachments(self):
        before = copy.deepcopy(self.app.state.store.state())
        self.login()
        run_id, records = self.start()
        reviewed = self.save_for_review(self.pick_group(records),
            subject='Revisão autorizada das taxas Orbe',
            body='Solicitamos esclarecer as taxas das operações listadas nas evidências anexas.')
        attachments = {}
        for item in reviewed['attachments']:
            response = self.client.get(item['url'])
            self.assertEqual(response.status_code, 200, response.text[:200])
            self.assertEqual(hashlib.sha256(response.content).hexdigest(), item['sha256'])
            attachments[item['name']] = response.content
        response = self.approve(reviewed)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['status'], 'sent')
        raw = next(call[1] for call in self.transport.calls if call[0] == 'data')
        message = BytesParser(policy=policy.default).parsebytes(raw)
        self.assertEqual(str(message['From']), EMAIL)
        self.assertEqual(str(message['To']), reviewed['to'])
        self.assertEqual(str(message['Subject']), reviewed['subject'])
        self.assertEqual(message.get_body(preferencelist=('plain',)).get_content().strip(), reviewed['body'].strip())
        self.assertEqual({part.get_filename(): part.get_payload(decode=True)
                          for part in message.iter_attachments()}, attachments)
        self.approve(reviewed)
        self.assertEqual(self.transport.count('data'), 1)
        stored = self.get(reviewed['id'])
        self.assertEqual(stored['status'], 'sent')
        self.assertEqual(stored['run_id'], run_id)
        after = self.app.state.store.state()
        for key in ('results', 'summary', 'closing', 'merchants', 'rates', 'parameters', 'sources'):
            self.assertEqual(before[key], after[key], key)
        rejected = self.client.post('/api/runs/' + run_id + '/approval', headers=self.actor,
            json={'decisao': 'reprovar', 'comentario': 'Revisão posterior ao contato; preservar histórico de envio.'})
        self.assertEqual(rejected.status_code, 200, rejected.text)
        available = self.client.get(BASE + '/runs')
        self.assertEqual(available.status_code, 200, available.text)
        historical_run = next(row for row in available.json()['runs'] if row['id'] == run_id)
        self.assertEqual(historical_run['status'], 'rejected')
        self.assertEqual(self.get(reviewed['id'])['status'], 'sent')
        self.assertEqual(self.transport.count('data'), 1)

    def test_dismissal_is_durable_and_does_not_authorize_a_send(self):
        self.login()
        run_id, records = self.start()
        reviewed = self.save_for_review(self.pick_group(records))
        response = self.client.post(BASE + '/' + reviewed['id'] + '/dismiss',
            headers=self.actor, json={'version': reviewed['version'], 'reason': 'Conferir com a equipe antes do contato.'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.get(reviewed['id'])['status'], 'dismissed')
        self.assertGreaterEqual(self.approve(reviewed).status_code, 400)
        response = self.client.post(BASE + '/prepare', headers=self.actor, json={'run_id': run_id})
        self.assertIn(response.status_code, (200, 201), response.text)
        self.assertEqual(self.get(reviewed['id'])['status'], 'dismissed')
        self.assertEqual(self.transport.count('data'), 0)

    def test_resolution_after_review_requires_refreshed_evidence_and_fresh_permission(self):
        self.login()
        run_id, records = self.start()
        reviewed = self.save_for_review(self.pick_group(records))
        item = reviewed['items'][0]
        response = self.client.post('/api/runs/' + run_id + '/exceptions/' + item['id'] + '/decision',
            headers=self.actor, json={'acao': 'aceitar', 'justificativa': 'Revisão humana posterior à sugestão.'})
        self.assertEqual(response.status_code, 200, response.text)
        response = self.approve(reviewed)
        self.assertGreaterEqual(response.status_code, 400, response.text)
        self.assertEqual(self.transport.count('data'), 0)
        self.assertGreater(reviewed['item_count'], 1)
        response = self.client.put(BASE + '/' + reviewed['id'], headers=self.actor,
            json={'version': reviewed['version'], 'refresh_evidence': True})
        self.assertEqual(response.status_code, 200, response.text)
        refreshed = self.get(reviewed['id'])
        self.assertEqual(refreshed['item_count'], reviewed['item_count'] - 1)
        self.assertNotIn(item['id'], [row['id'] for row in refreshed['items']])
        self.assertNotEqual(refreshed['content_hash'], reviewed['content_hash'])
        self.assertNotEqual(refreshed['evidence_hash'], reviewed['evidence_hash'])
        self.assertEqual(self.approve(reviewed).status_code, 409)
        self.assertEqual(self.transport.count('data'), 0)
        response = self.approve(refreshed)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['status'], 'sent')
        self.assertEqual(self.transport.count('data'), 1)

    def test_same_evidence_on_another_run_cannot_send_twice(self):
        self.login()
        _, records = self.start()
        reviewed = self.save_for_review(self.pick_group(records))
        first = self.approve(reviewed)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()['status'], 'sent')
        _, next_records = self.start()
        repeated = self.pick_group(next_records)
        # Saving a new run is allowed for review but must not bypass the durable
        # evidence/recipient/sender duplicate claim at the actual send boundary.
        response = self.client.put(BASE + '/' + repeated['id'], headers=self.actor, json={
            'version': repeated['version'], 'to': reviewed['to'],
            'subject': repeated['subject'], 'body': repeated['body']})
        self.assertEqual(response.status_code, 200, response.text)
        duplicate = self.get(repeated['id'])
        self.assertEqual(duplicate['duplicate_of'], reviewed['id'])
        self.assertEqual(duplicate['already_sent_count'], reviewed['item_count'])
        self.assertIn('SUGGESTION_ALREADY_SENT', [blocker['code'] for blocker in duplicate['blockers']])
        response = self.approve(duplicate)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()['error']['code'], 'SUGGESTION_REVIEW_REQUIRED')
        self.assertEqual(self.transport.count('data'), 1)

    def test_uncertain_provider_outcome_is_visible_and_cannot_be_replayed(self):
        self.login()
        _, records = self.start()
        reviewed = self.save_for_review(self.pick_group(records))
        self.transport.data_error = TimeoutError('sensitive transport detail')
        response = self.approve(reviewed)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['status'], 'uncertain')
        self.assertNotIn('sensitive transport detail', response.text)
        self.approve(reviewed)
        self.assertEqual(self.transport.count('data'), 1)
        response = self.client.put(BASE + '/' + reviewed['id'], headers=self.actor, json={
            'version': self.get(reviewed['id'])['version'], 'to': EMAIL,
            'subject': 'Revisão não deve reenviar', 'body': reviewed['body']})
        self.assertEqual(response.status_code, 409, response.text)


if __name__ == '__main__':
    unittest.main()
