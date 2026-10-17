"""Minimal Gmail OAuth, private server sessions and conservative send outcomes.

There is deliberately no runtime fake provider or endpoint override. Tests may inject
an object implementing GoogleProvider's methods. Gmail credentials never leave this
module; callers receive only the verified account and an opaque session reference.
"""
from __future__ import annotations

import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import threading
import time
from urllib.parse import urlencode, urlparse

import httpx

SCOPES = ("openid", "email", "https://www.googleapis.com/auth/gmail.send")
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
DEFAULT_REDIRECT_URI = "http://127.0.0.1:8765/api/mail/oauth/callback"
STATE_TTL = 600
SESSION_TTL = 8 * 60 * 60
_REPO = Path(__file__).resolve().parents[2]
_EMAIL = re.compile(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}\Z")


class AuthError(ValueError):
    def __init__(self, status: int, code: str, message: str, details=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details or []


class KnownSendFailure(Exception):
    """No Gmail send was attempted, or Gmail explicitly rejected the request."""
    outcome = "known_failure"

    def __init__(self, code="GMAIL_REJECTED", message="O Gmail recusou o envio; nenhuma aceitação foi confirmada."):
        super().__init__(message)
        self.code, self.message = code, message


class SendUncertain(Exception):
    """Gmail may have accepted the request. Never retry automatically."""
    outcome = "uncertain"

    def __init__(self, code="GMAIL_RESULT_UNCERTAIN", message="Não foi possível confirmar o resultado no Gmail. Não repita o envio automaticamente."):
        super().__init__(message)
        self.code, self.message = code, message


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _scopes(value) -> set[str]:
    if not isinstance(value, str):
        return set()
    result = set(value.split())
    if "https://www.googleapis.com/auth/userinfo.email" in result:
        result.remove("https://www.googleapis.com/auth/userinfo.email")
        result.add("email")
    return result


class GoogleProvider:
    """HTTP adapter with fixed Google endpoints and no retry on messages.send."""

    def __init__(self, client=None):
        self.client = client or httpx.Client(
            timeout=httpx.Timeout(25.0, connect=10.0), follow_redirects=False, trust_env=False)
        self._owns_client = client is None

    def _auth_json(self, method, url, **kwargs):
        try:
            response = self.client.request(method, url, **kwargs)
        except Exception:
            raise AuthError(503, "GOOGLE_UNAVAILABLE", "Não foi possível autenticar com o Google. Tente conectar novamente.") from None
        if response.status_code in (400, 401, 403):
            raise AuthError(401, "GOOGLE_AUTH_REJECTED", "O Google recusou a autorização. Conecte a conta de teste novamente.")
        if not 200 <= response.status_code < 300:
            raise AuthError(503, "GOOGLE_UNAVAILABLE", "O Google não confirmou a autenticação. Tente conectar novamente.")
        try:
            value = response.json()
        except Exception:
            raise AuthError(502, "GOOGLE_INVALID_RESPONSE", "O Google retornou uma resposta de autenticação inválida.") from None
        if not isinstance(value, dict):
            raise AuthError(502, "GOOGLE_INVALID_RESPONSE", "O Google retornou uma resposta de autenticação inválida.")
        return value

    def exchange_code(self, config, code, code_verifier):
        return self._auth_json("POST", TOKEN_URL, data={
            "client_id": config["client_id"], "client_secret": config["client_secret"],
            "redirect_uri": config["redirect_uri"], "grant_type": "authorization_code",
            "code": code, "code_verifier": code_verifier})

    def refresh(self, config, refresh_token):
        return self._auth_json("POST", TOKEN_URL, data={
            "client_id": config["client_id"], "client_secret": config["client_secret"],
            "grant_type": "refresh_token", "refresh_token": refresh_token})

    def userinfo(self, access_token):
        return self._auth_json("GET", USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})

    def revoke(self, token):
        try:
            response = self.client.post(REVOKE_URL, data={"token": token})
            return response.status_code == 200
        except Exception:
            return False

    def send(self, access_token, rawbytes):
        try:
            response = self.client.post(SEND_URL, headers={"Authorization": f"Bearer {access_token}"},
                                        json={"raw": _b64(rawbytes)})
        except Exception:
            raise SendUncertain() from None
        if response.status_code == 408:
            raise SendUncertain()
        if 400 <= response.status_code < 500:
            raise KnownSendFailure("GMAIL_REJECTED", "O Gmail recusou a solicitação de envio. Revise a conta e tente novamente somente após nova aprovação.")
        if not 200 <= response.status_code < 300:
            raise SendUncertain()
        try:
            value = response.json()
        except Exception:
            raise SendUncertain() from None
        if not isinstance(value, dict) or not isinstance(value.get("id"), str) or not value["id"].strip():
            raise SendUncertain()
        # Return only provider identifiers, never a raw provider response/body.
        result = {"id": value["id"]}
        if isinstance(value.get("threadId"), str) and value["threadId"].strip():
            result["threadId"] = value["threadId"]
        return result

    def close(self):
        if self._owns_client:
            self.client.close()


class AuthManager:
    def __init__(self, private_dir, provider=None, config=None):
        self._lock = threading.RLock()
        self.provider = provider if provider is not None else GoogleProvider()
        self.provider_mode = "injected_test" if provider is not None else "gmail"
        raw_path = Path(private_dir).expanduser()
        if raw_path.is_symlink():
            raise AuthError(500, "PRIVATE_DIRECTORY_INVALID", "A pasta de credenciais deve ser privada e ficar fora do projeto.")
        self.private_dir = raw_path.resolve()
        if self.private_dir == _REPO or _REPO in self.private_dir.parents:
            raise AuthError(500, "PRIVATE_DIRECTORY_INVALID", "A pasta de credenciais deve ficar fora do projeto.")
        self.private_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.private_dir, 0o700)
        self._state_file = self.private_dir / "oauth-state.json"
        self._state = {"connection": None, "sessions": {}, "pending": {}}
        if self._state_file.exists() or self._state_file.is_symlink():
            if self._state_file.is_symlink():
                raise AuthError(500, "PRIVATE_STATE_INVALID", "O armazenamento privado de autorização é inválido.")
            try:
                os.chmod(self._state_file, 0o600)
                state = json.loads(self._state_file.read_text("utf-8"))
                if not isinstance(state, dict) or not isinstance(state.get("sessions"), dict) or not isinstance(state.get("pending"), dict):
                    raise ValueError()
                self._state = state
            except Exception:
                raise AuthError(500, "PRIVATE_STATE_INVALID", "Não foi possível ler o armazenamento privado de autorização.") from None
        self.config, self.missing_config = self._config(config)
        # Changes to client, redirect or allowed account invalidate persisted grants.
        if self._state.get("connection") and not self._connection_allowed():
            self._state = {"connection": None, "sessions": {}, "pending": {}}
            self._save()

    def _config(self, injected):
        missing = []
        if injected is not None:
            raw = dict(injected)
        else:
            raw = {"redirect_uri": os.getenv("TARVO_GOOGLE_REDIRECT_URI", DEFAULT_REDIRECT_URI),
                   "test_account": os.getenv("TARVO_GMAIL_TEST_ACCOUNT", "")}
            filename = os.getenv("TARVO_GOOGLE_CLIENT_FILE", "")
            if not filename:
                missing.append("TARVO_GOOGLE_CLIENT_FILE")
            else:
                try:
                    path = Path(filename).expanduser().resolve()
                    if path == _REPO or _REPO in path.parents:
                        raise ValueError()
                    os.chmod(path, 0o600)
                    web = json.loads(path.read_text("utf-8"))["web"]
                    raw.update(client_id=web["client_id"], client_secret=web["client_secret"])
                    if web.get("redirect_uris") and raw["redirect_uri"] not in web["redirect_uris"]:
                        missing.append("TARVO_GOOGLE_REDIRECT_URI")
                except Exception:
                    missing.append("TARVO_GOOGLE_CLIENT_FILE")
        for key in ("client_id", "client_secret"):
            if not isinstance(raw.get(key), str) or not raw[key].strip():
                missing.append("TARVO_GOOGLE_CLIENT_FILE")
        redirect = raw.get("redirect_uri", DEFAULT_REDIRECT_URI)
        try:
            parsed = urlparse(redirect)
            valid_redirect = (parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost")
                              and parsed.path == "/api/mail/oauth/callback" and not parsed.username
                              and not parsed.password and not parsed.query and not parsed.fragment)
            parsed.port  # Validate numeric port; default HTTP port is permitted for tests.
        except (TypeError, ValueError):
            valid_redirect = False
        if not valid_redirect:
            missing.append("TARVO_GOOGLE_REDIRECT_URI")
        account = raw.get("test_account", "")
        account = account.strip().lower() if isinstance(account, str) else ""
        if not _EMAIL.fullmatch(account) or account == "financeiro@tarvo.com.br":
            missing.append("TARVO_GMAIL_TEST_ACCOUNT")
        result = {"client_id": raw.get("client_id", ""), "client_secret": raw.get("client_secret", ""),
                  "redirect_uri": redirect, "test_account": account}
        return result, sorted(set(missing))

    def _config_fingerprint(self):
        # Includes client secret so rotated clients cannot reuse an old connection.
        return _digest(json.dumps(self.config, sort_keys=True))

    def _configured(self):
        if self.missing_config:
            raise AuthError(503, "GMAIL_NOT_CONFIGURED", "Configure o OAuth Google e a conta Gmail de teste antes de conectar.", self.missing_config)

    def _save(self):
        tmp = self.private_dir / (".oauth-" + secrets.token_hex(12) + ".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(self._state, handle, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            # Windows antivirus/indexers can briefly hold the target; retry before failing.
            for attempt in range(10):
                try:
                    os.replace(tmp, self._state_file)
                    break
                except PermissionError:
                    if os.name != "nt" or attempt == 9:
                        raise
                    time.sleep(0.05)
            os.chmod(self._state_file, 0o600)
        finally:
            if tmp.exists():
                tmp.unlink()

    def _connection_allowed(self):
        connection = self._state.get("connection")
        return bool(not self.missing_config and isinstance(connection, dict)
                    and connection.get("email") == self.config["test_account"]
                    and connection.get("config_fingerprint") == self._config_fingerprint()
                    and connection.get("refresh_token") and connection.get("sub")
                    and set(connection.get("scopes", [])) == set(SCOPES))

    def _account(self):
        if not self._connection_allowed():
            return None
        connection = self._state["connection"]
        return {key: connection[key] for key in ("email", "sub", "connection_id")}

    def account(self):
        with self._lock:
            return self._account()

    def _session(self, token_hash):
        if not self._connection_allowed() or not token_hash:
            return None
        session = self._state["sessions"].get(token_hash)
        if not session or session.get("expires_at", 0) <= time.time():
            return None
        if session.get("connection_id") != self._state["connection"]["connection_id"]:
            return None
        return session

    def status(self, session_token=None):
        with self._lock:
            account = self._account()
            session = self._session(_digest(session_token)) if isinstance(session_token, str) and session_token else None
            result = {"configured": not self.missing_config, "connected": bool(account),
                      "email": account["email"] if account else None, "authorized": bool(session),
                      "missing_config": list(self.missing_config), "provider_mode": self.provider_mode,
                      "connection": account}
            if session:
                result["csrf_token"] = session["csrf_token"]
            return result

    def begin(self):
        with self._lock:
            self._configured()
            now = time.time()
            self._state["pending"] = {k: v for k, v in self._state["pending"].items() if v.get("expires_at", 0) > now}
            if len(self._state["pending"]) >= 20:
                raise AuthError(429, "OAUTH_PENDING_LIMIT", "Há várias conexões iniciadas. Aguarde alguns minutos e tente novamente.")
            state, binding, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(64)
            self._state["pending"][_digest(state)] = {
                "binding_hash": _digest(binding), "verifier": verifier, "expires_at": now + STATE_TTL,
                "config_fingerprint": self._config_fingerprint()}
            self._save()
            params = {"client_id": self.config["client_id"], "redirect_uri": self.config["redirect_uri"],
                      "response_type": "code", "scope": " ".join(SCOPES), "state": state,
                      "code_challenge": _b64(hashlib.sha256(verifier.encode("ascii")).digest()),
                      "code_challenge_method": "S256", "access_type": "offline",
                      "prompt": "consent select_account", "include_granted_scopes": "false",
                      "login_hint": self.config["test_account"]}
            return {"authorization_url": AUTH_URL + "?" + urlencode(params), "binding_cookie": binding}

    def _validated_token(self, token, previous=None):
        if not isinstance(token, dict) or not isinstance(token.get("access_token"), str) or not token["access_token"]:
            raise AuthError(502, "GOOGLE_TOKEN_INVALID", "O Google não retornou uma credencial válida.")
        if str(token.get("token_type", "")).lower() != "bearer":
            raise AuthError(502, "GOOGLE_TOKEN_INVALID", "O Google não retornou uma credencial válida.")
        granted = _scopes(token.get("scope")) if "scope" in token else set((previous or {}).get("scopes", []))
        if granted != set(SCOPES):
            raise AuthError(403, "GOOGLE_SCOPE_INVALID", "A conexão deve autorizar somente identidade e envio de e-mail; reconecte com as permissões solicitadas.")
        refresh = token.get("refresh_token") or (previous or {}).get("refresh_token")
        if not isinstance(refresh, str) or not refresh:
            raise AuthError(401, "GOOGLE_REFRESH_REQUIRED", "O Google não autorizou a conexão persistente. Conecte novamente e confirme o consentimento.")
        try:
            expires = float(token["expires_in"])
            if not math.isfinite(expires) or expires <= 0:
                raise ValueError()
        except (KeyError, TypeError, ValueError, OverflowError):
            raise AuthError(502, "GOOGLE_TOKEN_INVALID", "O Google não retornou uma credencial válida.") from None
        return {"access_token": token["access_token"], "refresh_token": refresh,
                "expires_at": time.time() + min(expires, 86400), "scopes": sorted(granted)}

    def _validated_identity(self, identity):
        if not isinstance(identity, dict):
            raise AuthError(403, "GOOGLE_ACCOUNT_INVALID", "Não foi possível verificar a conta Google.")
        email = identity.get("email")
        email = email.lower() if isinstance(email, str) else ""
        sub = identity.get("sub")
        if identity.get("email_verified") is not True or not isinstance(sub, str) or not sub.strip():
            raise AuthError(403, "GOOGLE_ACCOUNT_INVALID", "Não foi possível verificar a conta Google.")
        if email != self.config["test_account"] or email == "financeiro@tarvo.com.br":
            raise AuthError(403, "GOOGLE_ACCOUNT_NOT_ALLOWED", "Use somente a conta Gmail de teste configurada para esta demonstração.")
        return {"email": email, "sub": sub}

    def _revoke(self, token):
        try:
            return bool(token and self.provider.revoke(token))
        except Exception:
            return False

    def complete(self, state, code, binding_cookie):
        with self._lock:
            self._configured()
            if not all(isinstance(v, str) and v for v in (state, code, binding_cookie)):
                raise AuthError(400, "OAUTH_STATE_INVALID", "A conexão expirou ou não pertence a este navegador. Inicie novamente.")
            key = _digest(state)
            pending = self._state["pending"].get(key)
            if not pending or pending.get("expires_at", 0) <= time.time() or pending.get("config_fingerprint") != self._config_fingerprint():
                self._state["pending"].pop(key, None)
                self._save()
                raise AuthError(400, "OAUTH_STATE_INVALID", "A conexão expirou ou já foi utilizada. Inicie novamente.")
            if not secrets.compare_digest(pending["binding_hash"], _digest(binding_cookie)):
                raise AuthError(400, "OAUTH_BROWSER_MISMATCH", "A conexão não pertence a este navegador. Inicie novamente.")
            # Consume before exchanging the code: failures cannot replay an OAuth callback.
            self._state["pending"].pop(key)
            self._save()
            token = None
            try:
                token = self.provider.exchange_code(self.config, code, pending["verifier"])
                credentials = self._validated_token(token)
                identity = self._validated_identity(self.provider.userinfo(credentials["access_token"]))
            except AuthError:
                self._revoke((token or {}).get("refresh_token") or (token or {}).get("access_token") if isinstance(token, dict) else None)
                raise
            except Exception:
                self._revoke((token or {}).get("refresh_token") or (token or {}).get("access_token") if isinstance(token, dict) else None)
                raise AuthError(502, "GOOGLE_AUTH_FAILED", "Não foi possível concluir a conexão com o Google.") from None
            previous = self._state.get("connection")
            same_account = (self._connection_allowed() and previous["email"] == identity["email"]
                            and previous["sub"] == identity["sub"])
            connection = {**credentials, **identity,
                          "connection_id": previous["connection_id"] if same_account else secrets.token_urlsafe(24),
                          "connected_at": previous["connected_at"] if same_account else time.time(),
                          "config_fingerprint": self._config_fingerprint()}
            session_token, csrf = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
            sessions = {key: value for key, value in self._state["sessions"].items()
                        if same_account and value.get("expires_at", 0) > time.time()
                        and value.get("connection_id") == connection["connection_id"]}
            sessions[_digest(session_token)] = {
                "connection_id": connection["connection_id"], "csrf_token": csrf,
                "created_at": time.time(), "expires_at": time.time() + SESSION_TTL}
            self._state["connection"] = connection
            self._state["sessions"] = sessions
            self._save()
            return {"session_token": session_token, "email": identity["email"], "connection": self._account(),
                    "csrf_token": csrf, "expires_in": SESSION_TTL}

    def require_session(self, session_token, csrf):
        with self._lock:
            session_hash = _digest(session_token) if isinstance(session_token, str) and session_token else ""
            session = self._session(session_hash)
            if not session:
                raise AuthError(401, "GMAIL_SESSION_REQUIRED", "Conecte a conta Gmail de teste para autorizar esta ação.")
            if not isinstance(csrf, str) or not secrets.compare_digest(session["csrf_token"], csrf):
                raise AuthError(403, "GMAIL_CSRF_INVALID", "A confirmação de segurança expirou. Atualize a página e tente novamente.")
            return {**self._account(), "session_id": session_hash}

    def _context_valid(self, context):
        if not isinstance(context, dict) or not self._session(context.get("session_id")):
            return False
        account = self._account()
        return all(context.get(key) == account[key] for key in ("email", "sub", "connection_id"))

    def disconnect(self, context):
        with self._lock:
            if not self._context_valid(context):
                raise AuthError(401, "GMAIL_SESSION_REQUIRED", "Conecte a conta Gmail de teste para autorizar esta ação.")
            token = self._state["connection"]["refresh_token"]
            self._state = {"connection": None, "sessions": {}, "pending": {}}
            self._save()
            revoked = self._revoke(token)
            return {"disconnected": True, "revocation_confirmed": revoked}

    def send_message(self, auth_context, rawbytes):
        with self._lock:
            if not self._context_valid(auth_context):
                raise KnownSendFailure("GMAIL_SESSION_REQUIRED", "A conta foi desconectada ou a sessão expirou. Nenhum envio foi realizado.")
            if not isinstance(rawbytes, bytes) or not rawbytes:
                raise KnownSendFailure("MESSAGE_INVALID", "A mensagem está vazia ou inválida. Nenhum envio foi realizado.")
            current = self._state["connection"]
            try:
                refreshed = self.provider.refresh(self.config, current["refresh_token"])
                credentials = self._validated_token(refreshed, current)
                identity = self._validated_identity(self.provider.userinfo(credentials["access_token"]))
                if identity["sub"] != current["sub"]:
                    raise AuthError(403, "GOOGLE_ACCOUNT_CHANGED", "A identidade Google mudou. Conecte a conta novamente.")
                current.update(credentials)
                self._save()
            except AuthError as exc:
                if exc.code in {"GOOGLE_AUTH_REJECTED", "GOOGLE_ACCOUNT_INVALID", "GOOGLE_ACCOUNT_NOT_ALLOWED", "GOOGLE_ACCOUNT_CHANGED", "GOOGLE_SCOPE_INVALID"}:
                    self._state = {"connection": None, "sessions": {}, "pending": {}}
                    self._save()
                raise KnownSendFailure(exc.code, "Não foi possível renovar a autorização Google. Nenhum envio foi realizado; conecte a conta novamente.") from None
            except Exception:
                raise KnownSendFailure("GOOGLE_REFRESH_FAILED", "Não foi possível renovar a autorização Google. Nenhum envio foi realizado.") from None
            try:
                result = self.provider.send(credentials["access_token"], rawbytes)
            except (KnownSendFailure, SendUncertain):
                raise
            except Exception:
                raise SendUncertain() from None
            if not isinstance(result, dict) or not isinstance(result.get("id"), str) or not result["id"].strip():
                raise SendUncertain()
            return {key: result[key] for key in ("id", "threadId") if isinstance(result.get(key), str)}

    def close(self):
        close = getattr(self.provider, "close", None)
        if close:
            close()
