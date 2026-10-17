"""OAuth and Gmail boundary checks: mocked HTTP only, never real email."""
import base64
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import httpx

from src.mail.auth import (
    AuthError, AuthManager, GoogleProvider, KnownSendFailure, SendUncertain,
    AUTH_URL, TOKEN_URL, USERINFO_URL, SEND_URL, REVOKE_URL, SCOPES,
    STATE_TTL, SESSION_TTL,
)

CONFIG = {
    "client_id": "oauth-test.apps.googleusercontent.com", "client_secret": "client-secret-sensitive",
    "redirect_uri": "http://127.0.0.1/api/mail/oauth/callback", "test_account": "tarvo.demo@example.com",
}
# POSIX modes only: on Windows chmod toggles read-only, and privacy comes from the profile ACLs.
POSIX_MODES = os.name != "nt"
MIME = b"From: tarvo.demo@example.com\r\nTo: recipient@example.com\r\nSubject: Test\r\n\r\nTest only.\r\n"


class FakeGoogleHTTP:
    def __init__(self):
        self.calls = []
        self.token = {"access_token": "access-sensitive", "refresh_token": "refresh-sensitive",
                      "token_type": "Bearer", "expires_in": 3600, "scope": " ".join(SCOPES)}
        self.identity = {"email": CONFIG["test_account"], "sub": "verified-subject", "email_verified": True}
        self.send_status = 200
        self.send_body = {"id": "gmail-accepted-1", "threadId": "gmail-thread-1"}
        self.send_error = None
        self.refresh_error = None
        self.revoke_error = None

    def __call__(self, request):
        self.calls.append(request)
        if str(request.url) == TOKEN_URL:
            form = parse_qs(request.content.decode())
            if form.get("grant_type") == ["refresh_token"]:
                if self.refresh_error:
                    return httpx.Response(self.refresh_error, json={"error": "invalid_grant", "sensitive": "DO_NOT_EXPOSE"})
                token = dict(self.token, access_token="renewed-sensitive")
                token.pop("refresh_token", None)
                token.pop("scope", None)
                return httpx.Response(200, json=token)
            return httpx.Response(200, json=self.token)
        if str(request.url) == USERINFO_URL:
            return httpx.Response(200, json=self.identity)
        if str(request.url) == SEND_URL:
            if self.send_error:
                raise self.send_error
            if isinstance(self.send_body, bytes):
                return httpx.Response(self.send_status, content=self.send_body)
            return httpx.Response(self.send_status, json=self.send_body)
        if str(request.url) == REVOKE_URL:
            if self.revoke_error:
                raise self.revoke_error
            return httpx.Response(200, json={})
        raise AssertionError("Unexpected endpoint")

    def calls_to(self, url):
        return [request for request in self.calls if str(request.url) == url]


class MailAuthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.private = Path(self.tmp.name) / "private"
        self.http = FakeGoogleHTTP()
        self.client = httpx.Client(transport=httpx.MockTransport(self.http), follow_redirects=False)
        self.provider = GoogleProvider(client=self.client)
        self.manager = AuthManager(self.private, provider=self.provider, config=CONFIG)

    def tearDown(self):
        self.manager.close()
        self.client.close()
        self.tmp.cleanup()

    def begin(self):
        start = self.manager.begin()
        query = parse_qs(urlparse(start["authorization_url"]).query)
        return start, query

    def login(self):
        start, query = self.begin()
        result = self.manager.complete(query["state"][0], "provider-code", start["binding_cookie"])
        context = self.manager.require_session(result["session_token"], result["csrf_token"])
        return result, context

    def test_missing_config_is_reported_without_secret_or_fake_runtime_mode(self):
        with patch.dict("os.environ", {"TARVO_MAIL_FAKE_PROVIDER": "1"}, clear=True):
            manager = AuthManager(Path(self.tmp.name) / "unconfigured")
            try:
                status = manager.status()
                self.assertFalse(status["configured"])
                self.assertFalse(status["authorized"])
                self.assertEqual(status["provider_mode"], "gmail")
                self.assertEqual(set(status["missing_config"]), {"TARVO_GOOGLE_CLIENT_FILE", "TARVO_GMAIL_TEST_ACCOUNT"})
                self.assertNotIn("csrf_token", status)
                with self.assertRaises(AuthError) as caught:
                    manager.begin()
                self.assertEqual(caught.exception.status, 503)
            finally:
                manager.close()

    def test_web_client_file_outside_repo_has_private_mode_and_registered_redirect(self):
        client_file = Path(self.tmp.name) / "google-web-client.json"
        client_file.write_text(json.dumps({"web": {
            "client_id": CONFIG["client_id"], "client_secret": CONFIG["client_secret"],
            "redirect_uris": [CONFIG["redirect_uri"]]}}))
        with patch.dict("os.environ", {"TARVO_GOOGLE_CLIENT_FILE": str(client_file),
                                      "TARVO_GOOGLE_REDIRECT_URI": CONFIG["redirect_uri"],
                                      "TARVO_GMAIL_TEST_ACCOUNT": CONFIG["test_account"]}, clear=True):
            manager = AuthManager(Path(self.tmp.name) / "web-config", provider=self.provider)
            self.assertTrue(manager.status()["configured"])
            if POSIX_MODES:
                self.assertEqual(stat.S_IMODE(client_file.stat().st_mode), 0o600)
            manager.close()
            with patch.dict("os.environ", {"TARVO_GOOGLE_REDIRECT_URI": "http://127.0.0.1:9999/api/mail/oauth/callback"}):
                manager = AuthManager(Path(self.tmp.name) / "bad-redirect", provider=self.provider)
                self.assertFalse(manager.status()["configured"])
                self.assertIn("TARVO_GOOGLE_REDIRECT_URI", manager.status()["missing_config"])

    def test_authorization_requests_only_send_and_identity_with_pkce(self):
        start, query = self.begin()
        self.assertEqual(start["authorization_url"].split("?")[0], AUTH_URL)
        self.assertEqual(set(query["scope"][0].split()), set(SCOPES))
        self.assertEqual(query["code_challenge_method"], ["S256"])
        self.assertEqual(query["access_type"], ["offline"])
        self.assertEqual(query["include_granted_scopes"], ["false"])
        self.assertEqual(query["login_hint"], [CONFIG["test_account"]])
        self.assertNotIn(CONFIG["client_secret"], start["authorization_url"])
        self.manager.complete(query["state"][0], "provider-code", start["binding_cookie"])
        form = parse_qs(self.http.calls_to(TOKEN_URL)[0].content.decode())
        verifier = form["code_verifier"][0]
        expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        self.assertEqual(query["code_challenge"], [expected])
        self.assertGreaterEqual(len(verifier), 43)
        self.assertLessEqual(len(verifier), 128)
        self.assertEqual(form["grant_type"], ["authorization_code"])

    def test_sessions_are_hashed_private_and_csrf_is_only_returned_to_session(self):
        login, context = self.login()
        public = self.manager.status()
        self.assertTrue(public["connected"])
        self.assertFalse(public["authorized"])
        self.assertEqual(public["connection"], {key: context[key] for key in ("email", "sub", "connection_id")})
        self.assertNotIn("csrf_token", public)
        self.assertTrue(self.manager.status(login["session_token"])["authorized"])
        self.assertEqual(self.manager.status(login["session_token"])["csrf_token"], login["csrf_token"])
        state_file = self.private / "oauth-state.json"
        persisted = state_file.read_text()
        self.assertNotIn(login["session_token"], persisted)
        self.assertIn(hashlib.sha256(login["session_token"].encode()).hexdigest(), persisted)
        if POSIX_MODES:
            self.assertEqual(stat.S_IMODE(self.private.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(state_file.stat().st_mode), 0o600)
        for secret in ("access-sensitive", "refresh-sensitive", CONFIG["client_secret"]):
            self.assertNotIn(secret, json.dumps(public))
        self.assertFalse(self.manager.status("forged-token")["authorized"])

    def test_state_is_browser_bound_expiring_and_single_use(self):
        start, query = self.begin()
        state = query["state"][0]
        with self.assertRaises(AuthError) as caught:
            self.manager.complete(state, "provider-code", "wrong-browser")
        self.assertEqual(caught.exception.code, "OAUTH_BROWSER_MISMATCH")
        self.assertFalse(self.http.calls)
        self.manager.complete(state, "provider-code", start["binding_cookie"])
        with self.assertRaises(AuthError):
            self.manager.complete(state, "provider-code", start["binding_cookie"])
        self.assertEqual(len(self.http.calls_to(TOKEN_URL)), 1)
        start, query = self.begin()
        with patch("src.mail.auth.time.time", return_value=10**12):
            with self.assertRaises(AuthError):
                self.manager.complete(query["state"][0], "provider-code", start["binding_cookie"])
        self.assertEqual(len(self.http.calls_to(TOKEN_URL)), 1)

    def test_session_csrf_expiration_and_disconnect_invalidate_previous_session(self):
        login, context = self.login()
        with self.assertRaises(AuthError) as caught:
            self.manager.require_session(login["session_token"], "forged-csrf")
        self.assertEqual(caught.exception.status, 403)
        with self.assertRaises(AuthError):
            self.manager.require_session("forged-session", login["csrf_token"])
        with patch("src.mail.auth.time.time", return_value=10**12):
            self.assertFalse(self.manager.status(login["session_token"])["authorized"])
            with self.assertRaises(AuthError):
                self.manager.require_session(login["session_token"], login["csrf_token"])
        self.manager.disconnect(context)
        new_login, _ = self.login()
        self.assertNotEqual(new_login["connection"]["connection_id"], login["connection"]["connection_id"])
        with self.assertRaises(AuthError):
            self.manager.require_session(login["session_token"], login["csrf_token"])

    def test_same_account_can_authorize_two_browsers_without_invalidating_drafts(self):
        first, first_query = self.begin()
        second, second_query = self.begin()
        login1 = self.manager.complete(first_query["state"][0], "code1", first["binding_cookie"])
        login2 = self.manager.complete(second_query["state"][0], "code2", second["binding_cookie"])
        self.assertEqual(login1["connection"], login2["connection"])
        self.assertNotEqual(login1["session_token"], login2["session_token"])
        self.assertNotEqual(login1["csrf_token"], login2["csrf_token"])
        self.manager.require_session(login1["session_token"], login1["csrf_token"])
        self.manager.require_session(login2["session_token"], login2["csrf_token"])
        with self.assertRaises(AuthError):
            self.manager.require_session(login1["session_token"], login2["csrf_token"])

    def test_persisted_session_restores_but_config_changes_invalidate_it(self):
        login, _ = self.login()
        restored = AuthManager(self.private, provider=self.provider, config=CONFIG)
        self.assertTrue(restored.status(login["session_token"])["authorized"])
        self.assertEqual(restored.account(), self.manager.account())
        changed = AuthManager(self.private, provider=self.provider, config=dict(CONFIG, test_account="other.test@example.com"))
        self.assertFalse(changed.status(login["session_token"])["authorized"])
        self.assertFalse(changed.status()["connected"])

    def test_wrong_unverified_or_corporate_identity_cannot_connect(self):
        for identity in (
            dict(self.http.identity, email="other@example.com"),
            dict(self.http.identity, email="financeiro@tarvo.com.br"),
            dict(self.http.identity, email_verified=False),
            dict(self.http.identity, sub=""),
        ):
            with self.subTest(identity=identity):
                self.http.identity = identity
                start, query = self.begin()
                with self.assertRaises(AuthError):
                    self.manager.complete(query["state"][0], "code", start["binding_cookie"])
                self.assertFalse(self.manager.status()["connected"])
                with self.assertRaises(AuthError):
                    self.manager.complete(query["state"][0], "code", start["binding_cookie"])
        self.assertEqual(len(self.http.calls_to(REVOKE_URL)), 4)
        self.assertFalse(self.http.calls_to(SEND_URL))
        forbidden = AuthManager(Path(self.tmp.name) / "corporate", provider=self.provider,
                                config=dict(CONFIG, test_account="financeiro@tarvo.com.br"))
        self.assertFalse(forbidden.status()["configured"])

    def test_extra_missing_or_unverified_grants_are_rejected(self):
        for scope in (" ".join(SCOPES) + " https://www.googleapis.com/auth/gmail.readonly",
                      "openid email", "", None):
            with self.subTest(scope=scope):
                self.http.token["scope"] = scope
                start, query = self.begin()
                with self.assertRaises(AuthError) as caught:
                    self.manager.complete(query["state"][0], "code", start["binding_cookie"])
                self.assertEqual(caught.exception.code, "GOOGLE_SCOPE_INVALID")
                self.assertFalse(self.manager.status()["connected"])
        self.assertFalse(self.http.calls_to(SEND_URL))
        self.http.token["scope"] = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send"
        self.login()  # Google's canonical identity alias is equivalent to email.

    def test_refresh_identity_check_then_single_gmail_post(self):
        _, context = self.login()
        result = self.manager.send_message(context, MIME)
        self.assertEqual(result, {"id": "gmail-accepted-1", "threadId": "gmail-thread-1"})
        urls = [str(request.url) for request in self.http.calls]
        self.assertEqual(urls[-3:], [TOKEN_URL, USERINFO_URL, SEND_URL])
        request = self.http.calls_to(SEND_URL)[0]
        self.assertEqual(request.headers["authorization"], "Bearer renewed-sensitive")
        raw = json.loads(request.content)["raw"]
        self.assertEqual(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)), MIME)
        self.assertEqual(len(self.http.calls_to(SEND_URL)), 1)
        self.assertFalse(any("access_token" in str(r.url) for r in self.http.calls))

    def test_account_metadata_cannot_forge_a_send_session(self):
        self.login()
        with self.assertRaises(KnownSendFailure):
            self.manager.send_message(self.manager.account(), MIME)
        self.assertFalse(self.http.calls_to(SEND_URL))

    def test_disconnection_is_local_even_when_revocation_network_fails(self):
        login, context = self.login()
        self.http.revoke_error = httpx.ReadTimeout("sensitive details")
        result = self.manager.disconnect(context)
        self.assertTrue(result["disconnected"])
        self.assertFalse(result["revocation_confirmed"])
        self.assertFalse(self.manager.status()["connected"])
        self.assertFalse(self.manager.status(login["session_token"])["authorized"])
        with self.assertRaises(KnownSendFailure):
            self.manager.send_message(context, MIME)
        self.assertFalse(self.http.calls_to(SEND_URL))
        state = (self.private / "oauth-state.json").read_text()
        self.assertNotIn("refresh-sensitive", state)
        self.assertNotIn("access-sensitive", state)

    def test_refresh_failure_or_account_change_prevents_post_and_revokes_local_access(self):
        login, context = self.login()
        self.http.refresh_error = 400
        with self.assertRaises(KnownSendFailure) as caught:
            self.manager.send_message(context, MIME)
        self.assertEqual(caught.exception.outcome, "known_failure")
        self.assertNotIn("DO_NOT_EXPOSE", str(caught.exception))
        self.assertFalse(self.manager.status(login["session_token"])["authorized"])
        self.assertFalse(self.http.calls_to(SEND_URL))
        self.http.refresh_error = None
        _, context = self.login()
        self.http.identity = dict(self.http.identity, sub="different-subject")
        with self.assertRaises(KnownSendFailure):
            self.manager.send_message(context, MIME)
        self.assertFalse(self.http.calls_to(SEND_URL))

    def test_gmail_4xx_are_known_failures_and_never_retried(self):
        _, context = self.login()
        for status in (400, 401, 403, 404, 429):
            with self.subTest(status=status):
                before = len(self.http.calls_to(SEND_URL))
                self.http.send_status = status
                self.http.send_body = {"error": "DO_NOT_EXPOSE_access-sensitive"}
                with self.assertRaises(KnownSendFailure) as caught:
                    self.manager.send_message(context, MIME)
                self.assertEqual(caught.exception.outcome, "known_failure")
                self.assertNotIn("DO_NOT_EXPOSE", str(caught.exception))
                self.assertEqual(len(self.http.calls_to(SEND_URL)), before + 1)

    def test_uncertain_gmail_responses_are_never_retried(self):
        _, context = self.login()
        for status, body in ((408, {}), (500, {}), (503, {}), (302, {}), (200, b"not json"),
                             (200, {}), (200, {"id": ""}), (200, [])):
            with self.subTest(status=status, body=body):
                before = len(self.http.calls_to(SEND_URL))
                self.http.send_status, self.http.send_body = status, body
                with self.assertRaises(SendUncertain) as caught:
                    self.manager.send_message(context, MIME)
                self.assertEqual(caught.exception.outcome, "uncertain")
                self.assertEqual(len(self.http.calls_to(SEND_URL)), before + 1)
        for error in (httpx.ReadTimeout("access-sensitive"), httpx.ConnectError("refresh-sensitive")):
            with self.subTest(error=type(error).__name__):
                self.http.send_error = error
                before = len(self.http.calls_to(SEND_URL))
                with self.assertRaises(SendUncertain) as caught:
                    self.manager.send_message(context, MIME)
                self.assertNotIn("sensitive", str(caught.exception))
                self.assertEqual(len(self.http.calls_to(SEND_URL)), before + 1)

    def test_private_credentials_cannot_be_stored_inside_project(self):
        root = Path(__file__).resolve().parents[1]
        with self.assertRaises(AuthError) as caught:
            AuthManager(root / "do-not-create-oauth", provider=self.provider, config=CONFIG)
        self.assertEqual(caught.exception.code, "PRIVATE_DIRECTORY_INVALID")
        self.assertFalse((root / "do-not-create-oauth").exists())


if __name__ == "__main__":
    unittest.main()
