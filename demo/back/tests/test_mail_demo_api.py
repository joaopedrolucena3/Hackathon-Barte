"""Demo SMTP flow through the real API and pipeline with an isolated transport."""
import copy
from email import policy
from email.parser import BytesParser
import json
from pathlib import Path
import tempfile
import time
import unittest
import uuid

from fastapi.testclient import TestClient

from src.api.app import create_app
from src.mail.auth import AuthManager, GmailSMTPProvider
from src.store import ROOT
from test_mail_smtp import SMTPTransport


EMAIL = 'financeirotarvo@gmail.com'
PASSWORD = 'abcdefghijklmnop'


class DemoMailHTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.transport = SMTPTransport()
        self.auth = AuthManager(self.base / 'private', config={}, smtp_provider=GmailSMTPProvider(self.transport))
        self.app = create_app(self.base / 'case.sqlite3', ROOT / 'data/case', self.base / 'runs', mail_auth=self.auth)
        self.context = TestClient(self.app, base_url='http://127.0.0.1')
        self.client = self.context.__enter__()
        self.actor = {'X-User': 'Teste da demo'}

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.tmp.cleanup()

    def login(self):
        response = self.client.post('/api/mail/smtp/connect', json={'email': EMAIL, 'app_password': PASSWORD})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['authorized'])
        self.assertIn('HttpOnly', response.headers['set-cookie'])
        self.assertIn('Max-Age=2592000', response.headers['set-cookie'])
        self.assertNotIn(PASSWORD, response.text)
        self.headers = {**self.actor, 'X-CSRF-Token': response.json()['csrf_token']}

    def message(self, party='orbe'):
        return {'counterparty': party, 'to': EMAIL, 'subject': '[Tarvo Demo] Contato ' + party,
                'body': 'Mensagem de demonstração revisada.', 'request_id': str(uuid.uuid4())}

    def test_smtp_connection_and_manual_orbe_ponte_send_exact_mime_once(self):
        before = copy.deepcopy(self.app.state.store.state())
        self.login()
        for party in ('orbe', 'ponte'):
            payload = self.message(party)
            result = self.client.post('/api/mail/demo/send', json=payload, headers=self.headers)
            self.assertEqual(result.status_code, 200, result.text)
            sent = result.json()
            self.assertEqual(sent['status'], 'accepted')
            self.assertEqual(sent['smtp_response_code'], 250)
            self.assertNotIn('provider_message_id', sent)
            repeated = self.client.post('/api/mail/demo/send', json=payload, headers=self.headers)
            self.assertEqual(repeated.json(), sent)
            changed = self.client.post('/api/mail/demo/send', json={**payload, 'subject': 'Alterado'}, headers=self.headers)
            self.assertEqual(changed.status_code, 409)
        sends = [call[1] for call in self.transport.calls if call[0] == 'data']
        self.assertEqual(len(sends), 2)
        for raw in sends:
            message = BytesParser(policy=policy.default).parsebytes(raw)
            self.assertEqual(str(message['From']), EMAIL)
            self.assertEqual(str(message['To']), EMAIL)
            self.assertEqual(message.get_body().get_content().strip(), 'Mensagem de demonstração revisada.')
        after = self.app.state.store.state()
        for key in ('results', 'summary', 'closing', 'merchants', 'rates', 'parameters', 'sources'):
            self.assertEqual(before[key], after[key], key)
        for path in ('/api/state', '/api/mail/account', '/api/mail/demo/deliveries', '/api/mail/notifications'):
            self.assertNotIn(PASSWORD, self.client.get(path).text)

    def test_auth_origin_validation_and_uncertain_send_are_not_replayed(self):
        payload = self.message()
        self.assertEqual(self.client.post('/api/mail/demo/send', json=payload, headers=self.actor).status_code, 401)
        foreign = self.client.post('/api/mail/smtp/connect', json={'email': EMAIL, 'app_password': PASSWORD}, headers={'Origin': 'https://evil.example'})
        self.assertEqual(foreign.status_code, 403)
        self.assertEqual(self.transport.count('login'), 0)
        self.login()
        self.assertEqual(self.client.post('/api/mail/demo/send', json=payload, headers=self.actor).status_code, 403)
        malformed = self.client.post('/api/mail/smtp/connect', json={'email': EMAIL, 'app_password': PASSWORD, 'extra': PASSWORD})
        self.assertEqual(malformed.status_code, 422)
        self.assertNotIn(PASSWORD, malformed.text)
        self.transport.data_error = TimeoutError('secret must not be exposed')
        result = self.client.post('/api/mail/demo/send', json=payload, headers=self.headers).json()
        self.assertEqual(result['status'], 'uncertain')
        self.assertNotIn('secret must', json.dumps(result))
        self.client.post('/api/mail/demo/send', json=payload, headers=self.headers)
        self.assertEqual(self.transport.count('data'), 1)
        self.client.post('/api/mail/disconnect', json={}, headers=self.headers)
        self.assertEqual(self.client.post('/api/mail/demo/send', json=self.message(), headers=self.headers).status_code, 401)

    def test_pipeline_run_and_draft_emit_automatic_notices_and_manual_test(self):
        self.login()
        settings = self.client.put('/api/mail/notifications', json={'enabled': True, 'recipient': EMAIL}, headers=self.headers)
        self.assertEqual(settings.status_code, 200, settings.text)
        for draft, expected in ((False, 'awaiting_approval'), (True, 'done')):
            start = self.client.post('/api/runs', json={'pipeline_id': 'fechamento-tarvo', 'competencia': '2026-09', 'draft': draft}, headers=self.actor)
            self.assertEqual(start.status_code, 202, start.text)
            ident = start.json()['run_id']
            deadline = time.monotonic() + 30
            delivery = None
            while time.monotonic() < deadline:
                deliveries = self.client.get('/api/mail/notifications/deliveries').json()['deliveries']
                delivery = next((d for d in deliveries if d['run_id'] == ident and d['status'] != 'sending'), None)
                if delivery:
                    break
                time.sleep(.03)
            self.assertIsNotNone(delivery)
            self.assertEqual(delivery['status'], 'accepted', delivery)
            self.assertEqual(delivery['event'], expected)
            self.assertEqual(delivery['kind'], 'Teste' if draft else 'Fechamento')
            self.assertEqual(self.client.get('/api/runs/' + ident).json()['status'], expected)
        test = self.client.post('/api/mail/notifications/test', json={}, headers=self.headers)
        self.assertEqual(test.status_code, 200, test.text)
        self.assertEqual(test.json()['status'], 'accepted')
        self.assertEqual(self.transport.count('data'), 3)
