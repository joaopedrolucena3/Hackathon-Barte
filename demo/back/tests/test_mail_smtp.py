"""App-password and SMTP outcomes using an injected transport, never real email."""
import json
import os
from pathlib import Path
import smtplib
import ssl
import stat
import tempfile
import unittest
from unittest.mock import patch

from src.mail.auth import AuthError, AuthManager, GmailSMTPProvider, KnownSendFailure, SendUncertain, SESSION_TTL


EMAIL = "demo@gmail.com"
PASSWORD = "abcdefghijklmnop"
MIME = (b"From: demo@gmail.com\r\nTo: recipient@example.com\r\n"
        b"Subject: Test\r\nMessage-ID: <demo-test@tarvo.invalid>\r\n\r\nTest only.\r\n")


class SMTPTransport:
    def __init__(self):
        self.calls = []
        self.open_error = None
        self.login_error = None
        self.mail_error = None
        self.mail_code = 250
        self.rcpt_codes = []
        self.data_result = (250, b"accepted-sensitive-response")
        self.data_error = None
        self.close_error = None

    def __call__(self, host, port, timeout, context):
        self.calls.append(("connect", host, port, timeout, context))
        if self.open_error:
            raise self.open_error
        return self

    def ehlo(self):
        self.calls.append(("ehlo",))
        return 250, b"hello"

    def login(self, email, password):
        self.calls.append(("login", email, password))
        if self.login_error:
            raise self.login_error
        return 235, b"ok"

    def mail(self, sender):
        self.calls.append(("mail", sender))
        if self.mail_error:
            raise self.mail_error
        return self.mail_code, b"sender"

    def rcpt(self, address):
        self.calls.append(("rcpt", address))
        return self.rcpt_codes.pop(0) if self.rcpt_codes else 250, b"recipient"

    def data(self, rawbytes):
        self.calls.append(("data", rawbytes))
        if self.data_error:
            raise self.data_error
        return self.data_result

    def close(self):
        self.calls.append(("close",))
        if self.close_error:
            raise self.close_error

    def count(self, method):
        return sum(call[0] == method for call in self.calls)


class MailSMTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.private = Path(self.tmp.name) / "private"
        self.transport = SMTPTransport()
        self.provider = GmailSMTPProvider(smtp_factory=self.transport)
        self.manager = AuthManager(self.private, config={}, smtp_provider=self.provider)

    def tearDown(self):
        self.manager.close()
        self.tmp.cleanup()

    def login(self):
        result = self.manager.connect_smtp(" DEMO@GMAIL.COM ", "abcd efgh ijkl mnop")
        context = self.manager.require_session(result["session_token"], result["csrf_token"])
        return result, context

    def test_connection_verifies_fixed_gmail_tls_without_oauth_and_persists_private_secret(self):
        login, _ = self.login()
        connect = next(call for call in self.transport.calls if call[0] == "connect")
        self.assertEqual(connect[1:4], ("smtp.gmail.com", 465, 25))
        self.assertEqual(connect[4].verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(connect[4].check_hostname)
        self.assertGreater(connect[4].cert_store_stats()['x509_ca'], 0)
        self.assertIn(("login", EMAIL, PASSWORD), self.transport.calls)
        self.assertEqual(self.transport.count("data"), 0)
        self.assertEqual(login["expires_in"], 30 * 24 * 60 * 60)
        status = self.manager.status(login["session_token"])
        self.assertTrue(status["configured"])
        self.assertTrue(status["connected"])
        self.assertTrue(status["authorized"])
        self.assertEqual(status["provider"], "gmail_smtp")
        self.assertEqual(status["provider_mode"], "injected_test")
        self.assertFalse(status["oauth_configured"])
        self.assertEqual(status["missing_config"], [])
        self.assertNotIn(PASSWORD, json.dumps([login, status, self.manager.account()]))
        state_file = self.private / "oauth-state.json"
        self.assertIn(PASSWORD, state_file.read_text())
        self.assertNotIn(login["session_token"], state_file.read_text())
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE(state_file.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(self.private.stat().st_mode), 0o700)
        restored = AuthManager(self.private, config={}, smtp_provider=self.provider)
        try:
            self.assertTrue(restored.status(login["session_token"])["authorized"])
        finally:
            restored.close()

    def test_invalid_inputs_never_connect_or_persist(self):
        for email, password in (("", PASSWORD), ("financeiro@tarvo.com.br", PASSWORD),
                                ("bad\nemail@gmail.com", PASSWORD), (EMAIL, "normal-password"),
                                (EMAIL, ""), (EMAIL, "0123456789012345")):
            with self.subTest(email=email):
                with self.assertRaises(AuthError):
                    self.manager.connect_smtp(email, password)
        self.assertFalse(self.transport.calls)
        self.assertFalse((self.private / "oauth-state.json").exists())

    def test_failed_auth_does_not_replace_connection_or_expose_secret(self):
        login, _ = self.login()
        self.transport.login_error = smtplib.SMTPAuthenticationError(535, b"password-secret-from-server")
        with self.assertRaises(AuthError) as caught:
            self.manager.connect_smtp("other@gmail.com", PASSWORD)
        self.assertEqual(caught.exception.code, "SMTP_AUTH_REJECTED")
        self.assertNotIn("password-secret", str(caught.exception))
        self.assertEqual(self.manager.account()["email"], EMAIL)
        self.assertTrue(self.manager.status(login["session_token"])["authorized"])

    def test_mime_bytes_unchanged_no_fabricated_gmail_identifier_and_close_error_after_acceptance_ignored(self):
        _, context = self.login()
        self.transport.close_error = OSError("sensitive")
        result = self.manager.send_message(context, MIME)
        self.assertEqual(result, {"accepted": True, "provider": "gmail_smtp", "smtp_response_code": 250,
                                  "message_id": "<demo-test@tarvo.invalid>"})
        self.assertNotIn("id", result)
        self.assertNotIn("accepted-sensitive", str(result))
        self.assertEqual(self.transport.count("data"), 1)
        self.assertIn(("data", MIME), self.transport.calls)

    def test_rejected_recipient_prevents_data_for_every_recipient(self):
        _, context = self.login()
        self.transport.rcpt_codes = [250, 550]
        raw = MIME.replace(b"To: recipient@example.com", b"To: recipient@example.com, rejected@example.com")
        with self.assertRaises(KnownSendFailure) as caught:
            self.manager.send_message(context, raw)
        self.assertEqual(caught.exception.code, "SMTP_RECIPIENT_REJECTED")
        self.assertEqual(self.transport.count("rcpt"), 2)
        self.assertEqual(self.transport.count("data"), 0)

    def test_failure_before_data_is_known_and_timeout_during_data_is_uncertain_without_retry(self):
        _, context = self.login()
        self.transport.mail_error = TimeoutError("sensitive")
        with self.assertRaises(KnownSendFailure):
            self.manager.send_message(context, MIME)
        self.assertEqual(self.transport.count("data"), 0)
        self.transport.mail_error = None
        self.transport.data_error = TimeoutError("sensitive")
        with self.assertRaises(SendUncertain) as caught:
            self.manager.send_message(context, MIME)
        self.assertNotIn("sensitive", str(caught.exception))
        self.assertEqual(self.transport.count("data"), 1)

    def test_explicit_data_rejection_is_known_and_auth_revocation_disconnects(self):
        login, context = self.login()
        for error, response in ((smtplib.SMTPDataError(554, b"sensitive"), (250, b"")), (None, (554, b"sensitive"))):
            self.transport.data_error, self.transport.data_result = error, response
            with self.assertRaises(KnownSendFailure) as caught:
                self.manager.send_message(context, MIME)
            self.assertEqual(caught.exception.code, "SMTP_MESSAGE_REJECTED")
            self.assertNotIn("sensitive", str(caught.exception))
        self.transport.login_error = smtplib.SMTPAuthenticationError(535, b"sensitive")
        with self.assertRaises(KnownSendFailure):
            self.manager.send_message(context, MIME)
        self.assertFalse(self.manager.status(login["session_token"])["authorized"])
        self.assertNotIn(PASSWORD, (self.private / "oauth-state.json").read_text())

    def test_manual_session_csrf_and_background_capability_bound_to_current_connection(self):
        login, context = self.login()
        background = self.manager.background_context()
        with self.assertRaises(AuthError):
            self.manager.require_session(login["session_token"], "wrong-csrf")
        with self.assertRaises(KnownSendFailure):
            self.manager.send_message(self.manager.account(), MIME)
        with self.assertRaises(KnownSendFailure):
            self.manager.send_message(dict(background, background_token="forged"), MIME)
        with patch("src.mail.auth.time.time", return_value=10**12):
            self.assertFalse(self.manager.status(login["session_token"])["authorized"])
            self.assertTrue(self.manager.send_message(background, MIME)["accepted"])
        with self.assertRaises(AuthError):
            self.manager.disconnect(background)
        result = self.manager.disconnect(context)
        self.assertTrue(result["manual_revocation_required"])
        self.assertFalse(result["revocation_confirmed"])
        with self.assertRaises(KnownSendFailure):
            self.manager.send_message(background, MIME)
        with self.assertRaises(AuthError):
            self.manager.background_context()
        self.assertNotIn(PASSWORD, (self.private / "oauth-state.json").read_text())

    def test_reconnection_to_same_account_preserves_draft_identity_account_change_revokes_it(self):
        first, first_context = self.login()
        second, _ = self.login()
        self.assertEqual(first["connection"], second["connection"])
        self.manager.require_session(first["session_token"], first["csrf_token"])
        background = self.manager.background_context()
        self.manager.connect_smtp("other@gmail.com", PASSWORD)
        with self.assertRaises(KnownSendFailure):
            self.manager.send_message(first_context, MIME)
        with self.assertRaises(KnownSendFailure):
            self.manager.send_message(background, MIME)

    def test_private_directory_is_rejected_anywhere_inside_repository(self):
        repo = Path(__file__).resolve().parents[3]
        with self.assertRaises(AuthError):
            AuthManager(repo / "do-not-create-secrets", config={}, smtp_provider=self.provider)
        self.assertFalse((repo / "do-not-create-secrets").exists())


if __name__ == "__main__":
    unittest.main()
