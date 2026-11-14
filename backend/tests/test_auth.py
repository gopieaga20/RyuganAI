"""Owner login: accounts, sessions, route protection, CSRF, rate limit, profile settings. Uses an in-memory fake of the few tables involved."""
import os
import sys

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import account
import auth
import main

H = {"X-Requested-With": "ryugan"}
PW = "correct horse battery"


class Db:
    def __init__(self):
        self.users, self.sessions, self.settings, self.next_id, self.keys = [], {}, {}, 1, {}


class Conn:
    def __init__(self, db):
        self.db = db

    def transaction(self):
        class T:
            async def __aenter__(s): return None
            async def __aexit__(s, *a): return False
        return T()

    def _by_email(self, email):
        return next((u for u in self.db.users if u["email"] == email), None)

    async def execute(self, q, *a):
        d = self.db
        if "INSERT INTO app_settings" in q:
            d.settings[a[0]] = a[1]
        elif "DELETE FROM sessions WHERE token_hash = $1" in q:
            d.sessions.pop(a[0], None)
        elif "DELETE FROM sessions WHERE user_id = $1 AND token_hash <>" in q:
            d.sessions = {h: s for h, s in d.sessions.items() if not (s["user_id"] == a[0] and h != a[1])}
        elif "INSERT INTO sessions" in q:
            d.sessions[a[0]] = {"user_id": a[1]}
        elif "INSERT INTO ai_keys" in q:
            d.keys[a[1]] = {"user_id": a[0], "provider": a[1], "ciphertext": a[2], "last4": a[3]}
        elif "DELETE FROM ai_keys" in q:
            d.keys.pop(a[0], None)
        elif "UPDATE users SET pw_hash" in q:
            next(u for u in d.users if u["id"] == a[0])["pw_hash"] = a[1]
        # advisory lock, expired-session purge, last_seen refresh: nothing to do

    async def fetchval(self, q, *a):
        d = self.db
        if "COUNT(*) FROM users" in q:
            return len(d.users)
        if "FROM app_settings WHERE key = 'profile.signups_open'" in q:
            return d.settings.get("profile.signups_open")
        if "FROM app_settings WHERE key = $1" in q:
            return d.settings.get(a[0])
        if "SELECT 1 FROM users WHERE email = $1 AND id <> $2" in q:
            return 1 if any(u["email"] == a[0] and u["id"] != a[1] for u in d.users) else None
        if "SELECT 1 FROM users WHERE email = $1" in q:
            return 1 if self._by_email(a[0]) else None
        if "SELECT pw_hash FROM users WHERE id = $1" in q:
            return next(u for u in d.users if u["id"] == a[0])["pw_hash"]
        raise AssertionError("unexpected fetchval: " + q)

    async def fetch(self, q, *a):
        if "FROM ai_keys" in q:
            return list(self.db.keys.values())
        raise AssertionError("unexpected fetch: " + q)

    async def fetchrow(self, q, *a):
        d = self.db
        if "FROM ai_keys WHERE provider = $1" in q:
            return d.keys.get(a[0])
        if "INSERT INTO users" in q:
            u = {"id": d.next_id, "email": a[0], "pw_hash": a[1], "is_owner": a[2], "display_name": a[3]}
            d.next_id += 1
            d.users.append(u)
            return u
        if "FROM users WHERE email = $1" in q:
            return self._by_email(a[0])
        if "FROM sessions s JOIN users u" in q:
            s = d.sessions.get(a[0])
            if not s:
                return None
            return {**next(u for u in d.users if u["id"] == s["user_id"]), "stale": False}
        if "UPDATE users SET email" in q:
            u = next(u for u in d.users if u["id"] == a[0])
            u["email"] = a[1] or u["email"]
            u["display_name"] = a[2] if a[2] is not None else u["display_name"]
            return u
        raise AssertionError("unexpected fetchrow: " + q)


class Pool:
    connected = True

    def __init__(self):
        self.db = Db()

    def acquire(self):
        conn = Conn(self.db)

        class Ctx:
            async def __aenter__(s): return conn
            async def __aexit__(s, *a): return False
        return Ctx()


@pytest.fixture
def pool(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.delenv("OWNER_EMAIL", raising=False)
    auth._fails.clear()
    account.reset_cache()
    p = Pool()
    old = getattr(main.app.state, "pool", None)
    main.app.state.pool = p
    yield p
    main.app.state.pool = old
    account.reset_cache()


@pytest.fixture
def client(pool):
    return TestClient(main.app)


def register(c, email="owner@example.com", pw=PW):
    return c.post("/api/auth/register", json={"email": email, "password": pw}, headers=H)


# ───────────── passwords ─────────────
def test_password_hash_and_verify():
    h = auth.hash_password(PW)
    assert h.startswith("scrypt$") and PW not in h
    assert auth.verify_password(PW, h) and not auth.verify_password(PW + "x", h)
    assert not auth.verify_password(PW, None) and not auth.verify_password(PW, "garbage") and not auth.verify_password(PW, "md5$1$2$3$ab$cd")
    assert auth.hash_password(PW) != h                                    # per-user salt


def test_email_and_password_rules():
    assert auth.clean_email("  A@B.co ") == "a@b.co"
    for bad in ("", "nope", "a@b", "a b@c.com", "x" * 260 + "@a.com"):
        with pytest.raises(auth.AuthError):
            auth.clean_email(bad)
    with pytest.raises(auth.AuthError):
        auth.check_password_strength("short")


# ───────────── register / login ─────────────
def test_first_account_is_the_owner_and_gets_a_safe_cookie(client):
    st = client.get("/api/auth/status").json()
    assert st["auth_required"] and not st["has_owner"] and st["user"] is None
    r = register(client)
    assert r.status_code == 200 and r.json()["user"]["is_owner"] is True
    cookie = r.headers["set-cookie"].lower()
    assert "session=" in cookie and "httponly" in cookie and "samesite=lax" in cookie and "secure" not in cookie      # plain http in the test
    assert client.get("/api/auth/status").json()["user"]["email"] == "owner@example.com"


def test_cookie_is_secure_behind_https_proxy(client):
    r = client.post("/api/auth/register", json={"email": "o@example.com", "password": PW}, headers={**H, "X-Forwarded-Proto": "https"})
    assert "secure" in r.headers["set-cookie"].lower()


def test_only_the_session_hash_is_stored(client, pool):
    register(client)
    token = client.cookies.get("session")
    assert token and token not in pool.db.sessions and auth._hash_token(token) in pool.db.sessions


def test_second_signup_is_closed_until_the_owner_opens_it(client, pool):
    register(client)
    other = TestClient(main.app)
    assert register(other, "two@example.com").status_code == 403
    assert client.patch("/api/profile/settings", json={"signups_open": True}, headers=H).status_code == 200
    r = register(other, "two@example.com")
    assert r.status_code == 200 and r.json()["user"]["is_owner"] is False
    assert other.patch("/api/profile/settings", json={"signups_open": False}, headers=H).status_code == 403      # not the owner
    assert register(TestClient(main.app), "owner@example.com").status_code == 400                                 # taken address


def test_owner_email_env_limits_who_can_be_first(client, monkeypatch):
    monkeypatch.setenv("OWNER_EMAIL", "me@example.com")
    assert register(client, "someone@example.com").status_code == 403
    assert register(client, "ME@example.com").status_code == 200


def test_login_logout_and_wrong_password(client):
    register(client)
    other = TestClient(main.app)
    assert other.post("/api/auth/login", json={"email": "owner@example.com", "password": "wrong password!"}, headers=H).status_code == 401
    assert other.post("/api/auth/login", json={"email": "nobody@example.com", "password": PW}, headers=H).status_code == 401
    assert other.post("/api/auth/login", json={"email": "Owner@Example.com", "password": PW}, headers=H).status_code == 200
    assert other.get("/api/profile").status_code == 200
    assert other.post("/api/auth/logout", headers=H).status_code == 200
    assert other.get("/api/profile").status_code == 401


def test_login_is_rate_limited(client):
    register(client)
    other = TestClient(main.app)
    codes = [other.post("/api/auth/login", json={"email": "owner@example.com", "password": "bad password!"}, headers=H).status_code for _ in range(7)]
    assert codes[:5] == [401] * 5 and codes[5:] == [429, 429]
    assert other.post("/api/auth/login", json={"email": "owner@example.com", "password": PW}, headers=H).status_code == 429       # even the right one


# ───────────── protection ─────────────
def test_api_needs_a_session_but_the_login_endpoints_and_static_files_do_not(client):
    assert client.get("/api/paper/portfolio").status_code == 401
    assert client.get("/api/live/status").status_code == 401
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/auth/status").status_code == 200
    assert client.get("/").status_code != 401


def test_every_api_route_is_protected_unless_listed_public(client):
    seen = 0
    for route in main.app.routes:
        path = getattr(route, "path", "")
        if not path.startswith("/api") or not hasattr(route, "methods"):
            continue
        url = path.replace("{broker_id}", "angel").replace("{provider}", "anthropic")
        url = __import__("re").sub(r"\{[^}]+\}", "1", url)
        for m in route.methods - {"HEAD", "OPTIONS"}:
            r = client.request(m, url, headers=H)
            if auth.is_public(path):
                assert r.status_code != 401, (m, path)
            else:
                assert r.status_code == 401, (m, path, r.status_code)
            seen += 1
    assert seen > 40


def test_state_changing_calls_need_our_header_and_this_origin(client):
    assert client.post("/api/auth/register", json={"email": "a@b.co", "password": PW}).status_code == 403            # no header
    r = client.post("/api/auth/register", json={"email": "a@b.co", "password": PW}, headers={**H, "Origin": "https://evil.example"})
    assert r.status_code == 403
    assert register(client).status_code == 200
    assert client.post("/api/auth/logout", headers={**H, "Origin": "http://testserver"}).status_code == 200


def test_websocket_without_a_session_is_refused(client):
    with pytest.raises(WebSocketDisconnect) as e:
        with client.websocket_connect("/ws/prices") as ws:
            ws.send_json({"symbols": ["RELIANCE"]})
            ws.receive_json()
    assert e.value.code == 1008


def test_login_off_keeps_everything_open(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "0")
    assert TestClient(main.app).get("/api/auth/status").json()["auth_required"] is False


# ───────────── password change, profile ─────────────
def test_changing_the_password_signs_other_devices_out(client):
    register(client)
    phone = TestClient(main.app)
    phone.post("/api/auth/login", json={"email": "owner@example.com", "password": PW}, headers=H)
    assert phone.get("/api/profile").status_code == 200
    assert client.post("/api/auth/password", json={"current_password": "nope nope nope", "new_password": "another long one"}, headers=H).status_code == 403
    assert client.post("/api/auth/password", json={"current_password": PW, "new_password": "another long one"}, headers=H).status_code == 200
    assert client.get("/api/profile").status_code == 200 and phone.get("/api/profile").status_code == 401
    assert TestClient(main.app).post("/api/auth/login", json={"email": "owner@example.com", "password": "another long one"}, headers=H).status_code == 200


def test_profile_name_and_email_change(client):
    register(client)
    r = client.patch("/api/profile", json={"display_name": "Gopi"}, headers=H)
    assert r.status_code == 200 and r.json()["user"]["display_name"] == "Gopi"
    assert client.patch("/api/profile", json={"email": "new@example.com"}, headers=H).status_code == 403            # needs the password
    r = client.patch("/api/profile", json={"email": "new@example.com", "password": PW}, headers=H)
    assert r.status_code == 200 and r.json()["user"]["email"] == "new@example.com"


# ───────────── strategy toggles and live permission ─────────────
def test_strategy_toggles_are_saved_and_validated(client):
    register(client)
    s = client.get("/api/profile/settings").json()
    assert {x["id"] for x in s["strategies"] if x["enabled"]} == {"vwap"} and s["call_rule"] == "all"      # the defaults (VWAP alone)
    assert {x["id"] for x in s["strategies"]} >= {"trend", "smc", "sr", "news"}
    r = client.patch("/api/profile/settings", json={"strategies_enabled": ["trend", "rsi"]}, headers=H)
    assert {x["id"] for x in r.json()["strategies"] if x["enabled"]} == {"trend", "rsi"}
    # under the default rule (all must agree) any strategy that carries weight is enough; support/resistance (weight 0) or nothing is not
    assert client.patch("/api/profile/settings", json={"strategies_enabled": ["sr"]}, headers=H).status_code == 422
    assert client.patch("/api/profile/settings", json={"strategies_enabled": []}, headers=H).status_code == 422
    assert client.patch("/api/profile/settings", json={"strategies_enabled": ["rsi", "vwap"]}, headers=H).status_code == 200
    # the weighted-score rule needs their weights to add up to 3, and switching the rule is checked against the list already saved
    assert client.patch("/api/profile/settings", json={"call_rule": "score"}, headers=H).status_code == 422            # rsi 1 + vwap 1 = 2 < 3
    assert client.patch("/api/profile/settings", json={"strategies_enabled": ["trend", "rsi"], "call_rule": "score"}, headers=H).json()["call_rule"] == "score"
    assert client.patch("/api/profile/settings", json={"strategies_enabled": ["rsi", "vwap"]}, headers=H).status_code == 422   # still the score rule
    assert client.patch("/api/profile/settings", json={"call_rule": "bogus"}, headers=H).status_code == 422
    assert client.get("/api/profile/settings").json()["call_rule"] == "score"
    assert {x["id"] for x in client.get("/api/profile/settings").json()["strategies"] if x["enabled"]} == {"trend", "rsi"}
    assert client.patch("/api/profile/settings", json={"call_rule": "all"}, headers=H).json()["call_rule"] == "all"


def test_the_scan_gets_the_default_strategies_and_rule(client, pool):
    import asyncio
    register(client)
    deps = asyncio.run(main._autotrade_deps(pool))
    assert sorted(deps.disabled_strategies) == ["fvg", "news", "rsi", "smc", "sr", "structure", "trend", "volume"] and deps.call_rule == "all"


def test_live_is_refused_until_the_owner_allows_it_with_their_password(client, monkeypatch):
    register(client)
    monkeypatch.setattr(main, "_broker", lambda: type("B", (), {"needs_connect": False, "label": "x", "status": lambda s: {"connected": True}})())
    assert client.post("/api/live/enable", json={"phrase": "ENABLE LIVE"}, headers=H).status_code == 403
    assert client.patch("/api/profile/settings", json={"live_allowed": True}, headers=H).status_code == 403                       # no password
    assert client.patch("/api/profile/settings", json={"live_allowed": True, "password": "wrong wrong"}, headers=H).status_code == 403
    assert client.patch("/api/profile/settings", json={"live_allowed": True, "password": PW}, headers=H).json()["live_allowed"] is True
    assert client.post("/api/live/enable", json={"phrase": "ENABLE LIVE"}, headers=H).status_code == 200
    r = client.patch("/api/profile/settings", json={"live_allowed": False}, headers=H)          # turning it off also stops live mode
    assert r.json()["live_allowed"] is False and main._live_state["enabled"] is False
    assert client.post("/api/live/enable", json={"phrase": "ENABLE LIVE"}, headers=H).status_code == 403


# ───────────── AI keys ─────────────
SECRET = "a-long-random-test-secret-value"
FAKE_KEY = "sk-ant-api03-SUPERSECRETVALUE1234"


def test_ai_keys_are_stored_encrypted_masked_and_never_returned(client, pool, monkeypatch):
    monkeypatch.setenv("APP_SECRET_KEY", SECRET)
    register(client)
    r = client.put("/api/profile/ai-keys/anthropic", json={"key": FAKE_KEY, "model": "claude-test-1"}, headers=H)
    assert r.status_code == 200
    stored = pool.db.keys["anthropic"]
    assert FAKE_KEY not in stored["ciphertext"] and stored["last4"] == "1234"
    got = client.get("/api/profile/ai-keys")
    assert FAKE_KEY not in got.text and "SUPERSECRET" not in got.text
    row = next(p for p in got.json()["providers"] if p["provider"] == "anthropic")
    assert row["set"] is True and row["masked"].endswith("1234") and row["model"] == "claude-test-1"
    assert {p["provider"] for p in got.json()["providers"]} == {"anthropic", "openai", "gemini"} and got.json()["secret_ready"] is True
    assert client.delete("/api/profile/ai-keys/anthropic", headers=H).status_code == 200
    assert "anthropic" not in pool.db.keys


def test_ai_keys_need_the_server_secret_and_a_sane_key(client, monkeypatch):
    monkeypatch.delenv("APP_SECRET_KEY", raising=False)
    register(client)
    r = client.put("/api/profile/ai-keys/openai", json={"key": FAKE_KEY}, headers=H)
    assert r.status_code == 400 and "APP_SECRET_KEY" in r.json()["detail"]
    monkeypatch.setenv("APP_SECRET_KEY", SECRET)
    assert client.put("/api/profile/ai-keys/openai", json={"key": "short"}, headers=H).status_code == 400
    assert client.put("/api/profile/ai-keys/openai", json={"key": "has a space in it 12345"}, headers=H).status_code == 400
    assert client.put("/api/profile/ai-keys/openai", json={"model": "../etc/passwd"}, headers=H).status_code == 400
    assert client.put("/api/profile/ai-keys/nope", json={"key": FAKE_KEY}, headers=H).status_code == 404


def test_only_the_owner_manages_ai_keys(client, monkeypatch):
    monkeypatch.setenv("APP_SECRET_KEY", SECRET)
    register(client)
    client.patch("/api/profile/settings", json={"signups_open": True}, headers=H)
    other = TestClient(main.app)
    register(other, "two@example.com")
    assert other.get("/api/profile/ai-keys").status_code == 403
    assert other.put("/api/profile/ai-keys/openai", json={"key": FAKE_KEY}, headers=H).status_code == 403


def test_a_changed_secret_shows_re_enter_key_not_a_crash(client, monkeypatch):
    monkeypatch.setenv("APP_SECRET_KEY", SECRET)
    register(client)
    client.put("/api/profile/ai-keys/gemini", json={"key": "AIza-test-key-value-1234"}, headers=H)
    monkeypatch.setenv("APP_SECRET_KEY", "a-different-secret-entirely-now")
    row = next(p for p in client.get("/api/profile/ai-keys").json()["providers"] if p["provider"] == "gemini")
    assert row["set"] is False and "re-enter" in row["problem"]


def test_ai_chat_uses_the_active_provider_and_falls_back_to_the_server_key(client, monkeypatch):
    import ai_providers
    monkeypatch.setenv("APP_SECRET_KEY", SECRET)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    register(client)
    body = {"system": "s", "messages": [{"role": "user", "content": "hi"}]}
    r = client.post("/api/ai/chat", json=body, headers=H)
    assert r.status_code == 503 and "Profile" in r.json()["detail"]                       # nothing configured anywhere
    calls = []

    async def fake_chat(provider, key, model, system, messages, max_tokens=1200):
        calls.append((provider, key, model))
        return "answer"
    monkeypatch.setattr(ai_providers, "chat", fake_chat)
    client.put("/api/profile/ai-keys/openai", json={"key": "sk-openai-key-0000", "model": "gpt-x"}, headers=H)
    client.put("/api/profile/ai-active", json={"provider": "openai"}, headers=H)
    assert client.post("/api/ai/chat", json=body, headers=H).json() == {"text": "answer"}
    assert calls[-1] == ("openai", "sk-openai-key-0000", "gpt-x")
    client.put("/api/profile/ai-active", json={"provider": "anthropic"}, headers=H)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-env-fallback-key")                        # Anthropic, no saved key: the server's own key
    client.post("/api/ai/chat", json=body, headers=H)
    assert calls[-1][:2] == ("anthropic", "sk-env-fallback-key")


def test_a_provider_that_rejects_the_key_is_not_reported_as_our_401(client, monkeypatch):
    import ai_providers
    monkeypatch.setenv("APP_SECRET_KEY", SECRET)
    register(client)
    client.put("/api/profile/ai-keys/anthropic", json={"key": FAKE_KEY}, headers=H)

    async def rejecting(*a, **k):
        raise ai_providers.AIError(502, "Anthropic (Claude): invalid x-api-key")
    monkeypatch.setattr(ai_providers, "chat", rejecting)
    r = client.post("/api/ai/chat", json={"system": "s", "messages": [{"role": "user", "content": "hi"}]}, headers=H)
    assert r.status_code == 502 and FAKE_KEY not in r.text
    t = client.post("/api/profile/ai-keys/anthropic/test", headers=H).json()
    assert t["ok"] is False and "invalid" in t["error"]
