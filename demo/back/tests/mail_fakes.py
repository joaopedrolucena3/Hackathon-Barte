"""Network-free provider injected by tests; never selected by production config."""
from urllib.parse import parse_qs, urlencode, urlparse

from src.mail.auth import AuthManager, KnownSendFailure, SendUncertain

SCOPES = 'openid email https://www.googleapis.com/auth/gmail.send'


def test_config(base='http://127.0.0.1'):
    return {'client_id': 'test.apps.googleusercontent.com', 'client_secret': 'fake-client-secret',
            'redirect_uri': base+'/api/mail/oauth/callback', 'test_account': 'tarvo.demo@example.com'}


class FakeGoogleProvider:
    mode = 'simulated'

    def __init__(self, email='tarvo.demo@example.com'):
        self.email = email
        self.sends = []
        self.outcome = 'sent'
        self.on_send = None
        self.revoked = False
        self.exchanges = []

    def exchange_code(self, config, code, code_verifier):
        self.exchanges.append((code, code_verifier))
        return {'access_token': 'fake-access-token', 'refresh_token': 'fake-refresh-token',
                'expires_in': 3600, 'token_type': 'Bearer', 'scope': SCOPES}

    def refresh(self, config, refresh_token):
        return {'access_token': 'fake-new-access-token', 'expires_in': 3600, 'token_type': 'Bearer', 'scope': SCOPES}

    def userinfo(self, access_token):
        return {'email': self.email, 'sub': 'test-google-subject', 'email_verified': True}

    def send(self, access_token, rawbytes):
        self.sends.append(rawbytes)
        if self.on_send:
            self.on_send()
        if self.outcome == 'failed':
            raise KnownSendFailure('TEST_REJECTED', 'Falha conhecida do provedor de teste; nenhum envio real.')
        if self.outcome == 'uncertain':
            raise SendUncertain('TEST_TIMEOUT', 'Resultado incerto simulado; confira manualmente antes de qualquer novo envio.')
        return {'id': 'fake-gmail-'+str(len(self.sends)), 'threadId': 'fake-thread'}

    def revoke(self, token):
        self.revoked = True
        return True

    def close(self):
        pass


class BrowserDemoAuth(AuthManager):
    """Complete the real local cookie/state flow with a fake server-side provider.

    Used only by serve_mail_demo.py. No shortcut is registered on the real app.
    """
    def begin(self):
        result = super().begin()
        params = parse_qs(urlparse(result['authorization_url']).query)
        result['authorization_url'] = params['redirect_uri'][0]+'?'+urlencode({
            'state': params['state'][0], 'code': 'test-only-no-real-google'})
        return result
