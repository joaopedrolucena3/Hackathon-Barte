"""Review and OAuth-bound send contract through real FastAPI + SQLite, no network."""
import copy
import hashlib
import json
import tempfile
import unittest
from email import policy
from email.parser import BytesParser
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

from src.api.app import create_app
from src.api.mail import SESSION_COOKIE
from src.mail.auth import AuthManager
from src.store import ROOT
from mail_fakes import FakeGoogleProvider, test_config


class MailHTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.provider = FakeGoogleProvider()
        self.auth = AuthManager(self.base/'private', provider=self.provider, config=test_config())
        self.app = create_app(self.base/'case.sqlite3', ROOT/'data/case', self.base/'runs', mail_auth=self.auth)
        self.context = TestClient(self.app, base_url='http://127.0.0.1')
        self.client = self.context.__enter__()
        self.user = {'X-User': 'Analista declarado no teste'}
        self.store = self.app.state.store
        self.initial = copy.deepcopy(self.store.state())
        self.issue = next(i for i in self.initial['results']['pendencias'] if i['ref_origem']=='TX88410932')

    def tearDown(self):
        self.context.__exit__(None,None,None)
        self.tmp.cleanup()

    def connect(self):
        response = self.client.post('/api/mail/oauth/start',json={})
        self.assertEqual(response.status_code,200,response.text)
        params = parse_qs(urlparse(response.json()['authorization_url']).query)
        self.assertEqual(set(params['scope'][0].split()), {'openid','email','https://www.googleapis.com/auth/gmail.send'})
        response = self.client.get('/api/mail/oauth/callback',params={'code':'fake-code','state':params['state'][0]},follow_redirects=False)
        self.assertEqual(response.status_code,303,response.text)
        cookie = response.headers.get('set-cookie','')
        self.assertIn('HttpOnly',cookie)
        self.assertIn('SameSite=lax',cookie)
        state = self.client.get('/api/mail/account').json()
        self.assertTrue(state['authorized'],state)
        self.csrf = {'X-CSRF-Token':state['csrf_token']}
        return state

    def contact(self):
        response = self.client.put('/api/mail/contacts/orbe',headers=self.user,
            json={'email':'orbe.demo@example.com','name':'Orbe de teste','enabled':True})
        self.assertEqual(response.status_code,200,response.text)

    def draft(self):
        response = self.client.post('/api/mail/drafts',headers=self.user,json={'issue_id':self.issue['id_saida']})
        self.assertEqual(response.status_code,201,response.text)
        return response.json()

    def approve(self,draft,headers=None):
        return self.client.post('/api/mail/drafts/'+draft['id']+'/approve-send',
            headers=headers or {**self.user,**self.csrf},json={'version':draft['version'],'content_hash':draft['content_hash']})

    def test_declared_actor_cannot_authorize_and_no_credentials_in_json(self):
        self.contact()
        draft = self.draft()
        response = self.approve(draft, self.user)
        self.assertIn(response.status_code,(401,403),response.text)
        self.assertEqual(self.provider.sends,[])
        account = self.connect()
        response = self.approve(draft,self.user)
        self.assertEqual(response.status_code,403,response.text)
        self.assertEqual(self.provider.sends,[])
        for path in ['/api/mail/account','/api/state','/api/mail/drafts']:
            text = self.client.get(path).text
            for secret in ['fake-access-token','fake-refresh-token','fake-client-secret']:
                self.assertNotIn(secret,text)
        self.assertEqual(account['email'],'tarvo.demo@example.com')
        self.assertEqual(self.client.get('/api/mail/setup').status_code,200)

    def test_browser_binding_replay_and_foreign_origin_are_rejected(self):
        start = self.client.post('/api/mail/oauth/start',json={}).json()
        state = parse_qs(urlparse(start['authorization_url']).query)['state'][0]
        other = TestClient(self.app,base_url='http://127.0.0.1')
        response = other.get('/api/mail/oauth/callback',params={'state':state,'code':'fake-code'},follow_redirects=False)
        self.assertGreaterEqual(response.status_code,400)
        other.close()
        self.assertEqual(self.provider.exchanges,[])
        response = self.client.post('/api/mail/oauth/start',headers={'Origin':'https://untrusted.example'},json={})
        self.assertEqual(response.status_code,403)

    def test_edit_attachments_exact_send_and_idempotence_preserve_finance(self):
        self.connect(); self.contact()
        draft = self.draft()
        self.assertTrue(draft['attachments'])
        attachments = {}
        for item in draft['attachments']:
            response = self.client.get(item['url'])
            self.assertEqual(response.status_code,200)
            self.assertEqual(hashlib.sha256(response.content).hexdigest(),item['sha256'])
            self.assertIn('sandbox',response.headers['content-security-policy'])
            self.assertNotIn('PC-0926-',response.text)
            attachments[item['name']] = response.content
        response = self.client.put('/api/mail/drafts/'+draft['id'],headers=self.user,json={
            'version':draft['version'],'to':'orbe.revisao@example.com',
            'subject':'Revisão explícita da divergência','body':'Prezados, solicitamos esclarecer a divergência indicada nas evidências anexas.'})
        self.assertEqual(response.status_code,200,response.text)
        edited=response.json()
        self.assertEqual(self.approve(draft).status_code,409)
        response = self.approve(edited)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['status'],'sent')
        self.assertEqual(len(self.provider.sends),1)
        message=BytesParser(policy=policy.default).parsebytes(self.provider.sends[0])
        self.assertEqual(str(message['From']),'tarvo.demo@example.com')
        self.assertEqual(str(message['To']),'orbe.revisao@example.com')
        self.assertEqual(str(message['Subject']),edited['subject'])
        self.assertEqual(message.get_body(preferencelist=('plain',)).get_content().strip(),edited['body'].strip())
        self.assertEqual({part.get_filename():part.get_payload(decode=True) for part in message.iter_attachments()},attachments)
        self.approve(edited)
        self.assertEqual(len(self.provider.sends),1)
        final=self.store.state()
        for key in ['results','summary','closing','merchants','rates','parameters','sources']:
            self.assertEqual(final[key],self.initial[key],key)
        history=self.client.get('/api/mail/issues/'+draft['issue_id']+'/history')
        self.assertEqual(history.status_code,200)
        self.assertIn('fake-gmail-1',history.text)
        self.assertEqual(final['emails'],self.initial['emails'])

    def test_contact_is_required_and_disconnection_blocks_existing_approval(self):
        self.connect()
        draft=self.draft()
        self.assertTrue(draft['blockers'])
        self.assertGreaterEqual(self.approve(draft).status_code,400)
        self.assertEqual(self.provider.sends,[])
        self.contact()
        response=self.client.post('/api/mail/disconnect',headers=self.csrf,json={})
        self.assertEqual(response.status_code,200,response.text)
        self.assertTrue(self.provider.revoked)
        self.assertIn(self.approve(draft).status_code,(401,403))
        self.assertFalse(self.client.get('/api/mail/account').json()['authorized'])

    def test_uncertain_result_is_visible_and_never_retried(self):
        self.connect(); self.contact()
        draft=self.draft();self.provider.outcome='uncertain'
        response=self.approve(draft)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['status'],'uncertain')
        self.approve(draft)
        self.assertEqual(len(self.provider.sends),1)
        response=self.client.put('/api/mail/drafts/'+draft['id'],headers=self.user,json={
            'version':draft['version'],'subject':'Não repetir','body':'Nova revisão','to':draft['to']})
        self.assertEqual(response.status_code,409,response.text)

    def test_existing_billing_and_internal_notifications_remain_simulated(self):
        invoice=self.initial['results']['notas'][0]
        response=self.client.post('/api/emails/draft',json={'actor':'Teste legado','invoice_id':invoice['id_saida']})
        self.assertEqual(response.status_code,200,response.text)
        draft=response.json()['email']
        response=self.client.post('/api/emails/save',json={'actor':'Teste legado','id':draft['id'],
            'to':'cobranca.demo@example.com','subject':draft['subject'],'body':draft['body']})
        self.assertEqual(response.status_code,200,response.text)
        response=self.client.post('/api/emails/approve',json={'actor':'Teste legado','id':draft['id']})
        self.assertEqual(response.status_code,200,response.text)
        response=self.client.post('/api/emails/send',json={'actor':'Teste legado','id':draft['id']})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['email']['status'],'simulated')
        response=self.client.post('/api/notifications/run',json={'actor':'Teste legado'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(self.provider.sends,[])
        self.assertEqual(self.client.post('/api/emails/unknown',json={}).status_code,404)

    def test_known_failure_requires_new_reviewed_version_before_retry(self):
        self.connect(); self.contact()
        draft=self.draft(); self.provider.outcome='failed'
        response=self.approve(draft)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['status'],'failed')
        self.approve(draft)
        self.assertEqual(len(self.provider.sends),1)
        response=self.client.put('/api/mail/drafts/'+draft['id'],headers=self.user,json={
            'version':draft['version'],'to':draft['to'],'subject':draft['subject'],'body':draft['body']+'\nRevisado após falha.'})
        self.assertEqual(response.status_code,200,response.text)
        self.provider.outcome='sent'
        response=self.approve(response.json())
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['status'],'sent')
        self.assertEqual(len(self.provider.sends),2)


if __name__=='__main__':
    unittest.main()
