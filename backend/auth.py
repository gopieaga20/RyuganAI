"""Owner login for the dashboard: accounts, sessions, rate limiting, CSRF guard.

Design (see ARCHITECTURE.md): the app is single-tenant. The first account that registers becomes the owner; later sign-ups are
refused unless the owner opens them. Everything under /api (except the login endpoints) needs a valid session cookie.
Passwords: scrypt with a per-user salt. Sessions: random token in an httpOnly cookie; only its SHA-256 is stored, so a database
leak does not hand out logins and logout / password change can revoke sessions.

AUTH_REQUIRED=0 turns the whole thing off (tests and local experiments). It is read on every request.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import time
from typing import Optional

COOKIE = "session"
SESSION_DAYS = 14
MIN_PASSWORD = 10
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "ryugan"
_SCRYPT = (2 ** 14, 8, 1)                      # n, r, p  (about 16 MB, ~50 ms)

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS users (
        id           BIGSERIAL PRIMARY KEY,
        email        TEXT UNIQUE NOT NULL,
        pw_hash      TEXT,
        is_owner     BOOLEAN NOT NULL DEFAULT FALSE,
        display_name TEXT NOT NULL DEFAULT '',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ip         TEXT,
        ua         TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS ai_keys (
        user_id    BIGINT NOT NULL,
        provider   TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        last4      TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, provider)
    )""",
]


class AuthError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def required() -> bool:
    return os.getenv("AUTH_REQUIRED", "1").strip().lower() not in ("0", "false", "no", "off")


LOCAL_USER = {"id": 0, "email": "local", "display_name": "Local (login off)", "is_owner": True}


# ───────────── passwords ─────────────
def hash_password(password: str) -> str:
    n, r, p = _SCRYPT
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(password.encode(), salt=salt, n=n, r=r, p=p, dklen=32)
    return f"scrypt${n}${r}${p}${salt.hex()}${h.hex()}"


def verify_password(password: str, stored: Optional[str]) -> bool:
    try:
        scheme, n, r, p, salt, h = (stored or "").split("$")
        if scheme != "scrypt":
            return False
        calc = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(calc.hex(), h)
    except (ValueError, TypeError):
        return False


_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def clean_email(email: str) -> str:
    e = (email or "").strip().lower()
    if len(e) > 254 or not _EMAIL.match(e):
        raise AuthError(400, "Enter a valid email address.")
    return e


def check_password_strength(password: str) -> None:
    if len(password or "") < MIN_PASSWORD:
        raise AuthError(400, f"Use a password of at least {MIN_PASSWORD} characters.")
    if len(password) > 200:
        raise AuthError(400, "That password is too long.")


# ───────────── rate limit (one process; in memory) ─────────────
_fails: dict = {}
LIMITS = {"e": 5, "i": 20}
WINDOW = 15 * 60


def _recent(key: str, now: float) -> list:
    xs = [t for t in _fails.get(key, []) if now - t < WINDOW]
    _fails[key] = xs
    return xs


def blocked(ip: str, email: str, now: Optional[float] = None) -> bool:
    now = now or time.time()
    return len(_recent("e:" + email, now)) >= LIMITS["e"] or len(_recent("i:" + ip, now)) >= LIMITS["i"]


def note_failure(ip: str, email: str, now: Optional[float] = None) -> None:
    now = now or time.time()
    _recent("e:" + email, now).append(now)
    _recent("i:" + ip, now).append(now)


def note_success(email: str) -> None:
    _fails.pop("e:" + email, None)


def client_ip(request) -> str:
    """Behind nginx the connection comes from 127.0.0.1; nginx appends the real address as the LAST X-Forwarded-For entry."""
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[-1].strip()
    return request.client.host if request.client else "?"


def is_https(request) -> bool:
    return request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip() == "https"


# ───────────── database ─────────────
async def ensure_schema(conn) -> None:
    for stmt in SCHEMA:
        await conn.execute(stmt)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _user(row) -> dict:
    return {"id": row["id"], "email": row["email"], "display_name": row["display_name"], "is_owner": bool(row["is_owner"])}


async def count_users(pool) -> int:
    async with pool.acquire() as conn:
        return int(await conn.fetchval("SELECT COUNT(*) FROM users") or 0)


async def get_setting(pool, key: str, default: str = "") -> str:
    async with pool.acquire() as conn:
        v = await conn.fetchval("SELECT value FROM app_settings WHERE key = $1", key)
    return v if v is not None else default


async def set_setting(pool, key: str, value: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", key, value)


async def signups_open(pool) -> bool:
    return (await get_setting(pool, "profile.signups_open", "0")) == "1"


async def register(pool, email: str, password: str, name: str = "") -> dict:
    """First account becomes the owner. Later ones need profile.signups_open. OWNER_EMAIL (optional) limits who may be first."""
    email = clean_email(email)
    check_password_strength(password)
    pw = hash_password(password)
    name = (name or "").strip()[:80] or email.split("@")[0]
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(7001)")          # two simultaneous first sign-ups must not both become owner
            n = int(await conn.fetchval("SELECT COUNT(*) FROM users") or 0)
            if n == 0:
                want = os.getenv("OWNER_EMAIL", "").strip().lower()
                if want and want != email:
                    raise AuthError(403, "This address may not create the owner account.")
            else:
                v = await conn.fetchval("SELECT value FROM app_settings WHERE key = 'profile.signups_open'")
                if v != "1":
                    raise AuthError(403, "Sign-ups are closed. Ask the owner to open them.")
            if await conn.fetchval("SELECT 1 FROM users WHERE email = $1", email):
                raise AuthError(400, "Could not create that account.")        # same text whether or not the address is taken
            row = await conn.fetchrow(
                "INSERT INTO users (email, pw_hash, is_owner, display_name) VALUES ($1, $2, $3, $4) RETURNING id, email, display_name, is_owner",
                email, pw, n == 0, name)
    return _user(row)


async def login(pool, email: str, password: str) -> dict:
    email = (email or "").strip().lower()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT id, email, display_name, is_owner, pw_hash FROM users WHERE email = $1", email)
    ok = verify_password(password or "", row["pw_hash"] if row else None)
    if not row:
        hash_password("x")                                                       # same work whether or not the account exists
    if not ok:
        raise AuthError(401, "Wrong email or password.")
    return _user(row)


async def create_session(pool, user_id: int, ip: str, ua: str) -> str:
    token = secrets.token_urlsafe(32)
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM sessions WHERE expires_at < NOW()")
        await conn.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at, ip, ua) VALUES ($1, $2, NOW() + make_interval(days => $3), $4, $5)",
            _hash_token(token), user_id, SESSION_DAYS, ip[:64], (ua or "")[:200])
    return token


async def user_for_token(pool, token: Optional[str]) -> Optional[dict]:
    """The account a session cookie belongs to; refreshes the 14-day expiry (at most about once an hour). None if unknown or expired."""
    if not token:
        return None
    h = _hash_token(token)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT u.id, u.email, u.display_name, u.is_owner, s.last_seen < NOW() - INTERVAL '1 hour' AS stale
               FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > NOW()""", h)
        if not row:
            return None
        if row["stale"]:
            await conn.execute("UPDATE sessions SET last_seen = NOW(), expires_at = NOW() + make_interval(days => $2) WHERE token_hash = $1", h, SESSION_DAYS)
    return _user(row)


async def end_session(pool, token: Optional[str]) -> None:
    if token:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM sessions WHERE token_hash = $1", _hash_token(token))


async def end_other_sessions(pool, user_id: int, keep_token: Optional[str]) -> None:
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", user_id, _hash_token(keep_token or ""))


async def change_password(pool, user_id: int, current: str, new: str, keep_token: Optional[str]) -> None:
    check_password_strength(new)
    async with pool.acquire() as conn:
        stored = await conn.fetchval("SELECT pw_hash FROM users WHERE id = $1", user_id)
        if not verify_password(current or "", stored):
            raise AuthError(403, "The current password is wrong.")
        await conn.execute("UPDATE users SET pw_hash = $2 WHERE id = $1", user_id, hash_password(new))
    await end_other_sessions(pool, user_id, keep_token)


async def verify_user_password(pool, user_id: int, password: str) -> bool:
    async with pool.acquire() as conn:
        stored = await conn.fetchval("SELECT pw_hash FROM users WHERE id = $1", user_id)
    return verify_password(password or "", stored)


# ───────────── request guards ─────────────
PUBLIC_API = ("/api/health", "/api/auth/status", "/api/auth/login", "/api/auth/register")
UNSAFE = ("POST", "PUT", "PATCH", "DELETE")


def is_public(path: str) -> bool:
    if path in PUBLIC_API:
        return True
    # the broker redirects the browser back here after login; the call verifies its own one-time `state`
    return path.startswith("/api/brokers/") and path.endswith("/callback")


def origin_ok(origin: Optional[str], host: Optional[str], allowed: list) -> bool:
    """A request that names its origin must come from this site (or a configured one)."""
    if not origin:
        return True
    o = origin.rstrip("/")
    if o in [a.rstrip("/") for a in allowed]:
        return True
    return bool(host) and o.split("://", 1)[-1] == host


def csrf_ok(request, allowed: list) -> bool:
    """State-changing calls must carry our header (a cross-site form cannot set it; a cross-site fetch would need a CORS preflight we
    refuse) and, when the browser says where it came from, that must be this site."""
    if request.headers.get(CSRF_HEADER, "").lower() != CSRF_VALUE:
        return False
    return origin_ok(request.headers.get("origin"), request.headers.get("host"), allowed)


async def user_for_request(pool, request) -> Optional[dict]:
    if not required():
        return LOCAL_USER
    return await user_for_token(pool, request.cookies.get(COOKIE))


async def ws_user(pool, websocket, allowed: list) -> Optional[dict]:
    """Same check for a WebSocket: valid cookie and an Origin that is this site."""
    if not required():
        return LOCAL_USER
    if not origin_ok(websocket.headers.get("origin"), websocket.headers.get("host"), allowed):
        return None
    return await user_for_token(pool, websocket.cookies.get(COOKIE))


def set_cookie(response, request, token: str) -> None:
    response.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax", secure=is_https(request), path="/")


def clear_cookie(response) -> None:
    response.delete_cookie(COOKIE, path="/")


# ───────────── command line: python auth.py reset-password you@example.com ─────────────
if __name__ == "__main__":
    import asyncio
    import getpass
    import sys

    import asyncpg
    from dotenv import load_dotenv

    load_dotenv()

    async def _reset(email: str):
        pw = getpass.getpass("New password: ")
        check_password_strength(pw)
        conn = await asyncpg.connect(os.environ["DATABASE_URL"])
        try:
            done = await conn.execute("UPDATE users SET pw_hash = $2 WHERE email = $1", clean_email(email), hash_password(pw))
            await conn.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = $1)", clean_email(email))
            print("Password changed; every session was signed out." if done.endswith("1") else "No account with that email.")
        finally:
            await conn.close()

    if len(sys.argv) == 3 and sys.argv[1] == "reset-password":
        asyncio.run(_reset(sys.argv[2]))
    else:
        print("usage: python auth.py reset-password <email>")
