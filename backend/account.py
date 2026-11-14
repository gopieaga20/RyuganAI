"""Login, registration and the Profile settings endpoints (account, strategy toggles, live permission).

Kept out of main.py so it stays testable on its own. `hooks["live_off"]` is set by main.py: it switches in-memory live trading off
when the profile switch "Allow live trading" is turned off.
"""
from __future__ import annotations

import json
import re
from typing import Callable, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import ai_providers
import auth
import crypto
import strategy_vote

router = APIRouter()
hooks: dict = {"live_off": None}                       # type: dict[str, Optional[Callable]]
_cache: dict = {"live": None, "enabled": None, "rule": None}   # loaded on first use, refreshed whenever the owner saves
# The default strategy set and rule (set 14 Nov 2026): VWAP alone. Backtests (4 years, 34 symbols, same-day exit, reports/vwap_stress_test_slots99_1500d.md): VWAP alone
# +150 Rs per trade before a spread, +50 with a 1% round-trip spread, -50 with 2%, positive in both halves; every combination with Structure, FVG, SMC or EMA trend was worse.
DEFAULT_ENABLED = ["vwap"]
CALL_RULES = ("all", "score")


def _pool(request: Request):
    return request.app.state.pool


def _fail(e: auth.AuthError):
    return HTTPException(status_code=e.status, detail=e.message)


# ───────────── settings helpers (also used by main.py) ─────────────
async def live_allowed(pool) -> bool:
    """The profile switch 'Allow live trading' (default off). The real-money gate: /api/live/enable refuses while it is off."""
    if _cache["live"] is None:
        _cache["live"] = (await auth.get_setting(pool, "profile.live_allowed", "0")) == "1"
    return bool(_cache["live"])


def all_strategy_ids() -> list:
    return list(strategy_vote.STRATEGIES)


async def enabled_strategies(pool) -> list:
    """Ids the owner left switched on (all of them until changed)."""
    if _cache["enabled"] is None:
        raw = await auth.get_setting(pool, "profile.strategies_enabled", "")
        try:
            ids = json.loads(raw) if raw else None
        except ValueError:
            ids = None
        known = all_strategy_ids()
        _cache["enabled"] = [i for i in known if i in (ids if isinstance(ids, list) else DEFAULT_ENABLED)]
    return list(_cache["enabled"])


async def call_rule(pool) -> str:
    """How the switched-on strategies combine into a call: 'all' (every one must agree, the default) or 'score' (weighted score of +-3)."""
    if _cache["rule"] is None:
        v = await auth.get_setting(pool, "profile.call_rule", "all")
        _cache["rule"] = v if v in CALL_RULES else "all"
    return _cache["rule"]


def rule_problem(ids: list, rule: str):
    """Why this set of strategies could never produce a call under `rule`, or None."""
    weights = [strategy_vote.STRATEGIES[i] for i in ids]
    if rule == "all":
        return None if any(w > 0 for w in weights) else "Keep at least one strategy with a vote weight switched on (support/resistance has weight 0)."
    return None if sum(weights) >= strategy_vote.CALL_SCORE else (
        f"With the weighted-score rule the switched-on strategies' vote weights must add up to at least {strategy_vote.CALL_SCORE} (support/resistance has weight 0).")


async def disabled_strategies(pool) -> list:
    """Ids to leave out of every vote. Never raises: if the settings cannot be read, nothing is disabled."""
    try:
        on = set(await enabled_strategies(pool))
        return [i for i in all_strategy_ids() if i not in on]
    except Exception as e:
        print(f"[WARN] strategy settings unreadable, using all strategies: {e}")
        return []


def reset_cache() -> None:
    _cache.update(live=None, enabled=None, rule=None)


# ───────────── models ─────────────
class Credentials(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)
    display_name: Optional[str] = Field(default=None, max_length=80)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: str = Field(max_length=200)


class ProfilePatch(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=80)
    email: Optional[str] = Field(default=None, max_length=254)
    password: Optional[str] = Field(default=None, max_length=200)       # required when the email changes


class SettingsPatch(BaseModel):
    signups_open: Optional[bool] = None
    live_allowed: Optional[bool] = None
    password: Optional[str] = Field(default=None, max_length=200)       # required to switch live trading ON
    strategies_enabled: Optional[list[str]] = Field(default=None, max_length=50)
    call_rule: Optional[str] = Field(default=None, pattern="^(all|score)$")


async def _need_user(request: Request) -> dict:
    user = await auth.user_for_request(_pool(request), request)
    if not user:
        raise HTTPException(status_code=401, detail="Sign in first.")
    return user


async def _need_owner(request: Request) -> dict:
    user = await _need_user(request)
    if not user.get("is_owner"):
        raise HTTPException(status_code=403, detail="Only the owner can change this.")
    return user


# ───────────── auth ─────────────
@router.get("/api/auth/status")
async def status(request: Request):
    if not auth.required():
        return {"auth_required": False, "has_owner": True, "signups_open": False, "user": auth.LOCAL_USER}
    pool = _pool(request)
    return {"auth_required": True, "has_owner": await auth.count_users(pool) > 0, "signups_open": await auth.signups_open(pool),
            "user": await auth.user_for_request(pool, request)}


async def _start_session(request: Request, user: dict):
    token = await auth.create_session(_pool(request), user["id"], auth.client_ip(request), request.headers.get("user-agent", ""))
    resp = JSONResponse({"user": user})
    auth.set_cookie(resp, request, token)
    return resp


@router.post("/api/auth/register")
async def register(body: Credentials, request: Request):
    ip = auth.client_ip(request)
    if auth.blocked(ip, "register"):
        raise HTTPException(status_code=429, detail="Too many attempts. Try again in a few minutes.")
    try:
        user = await auth.register(_pool(request), body.email, body.password, body.display_name or "")
    except auth.AuthError as e:
        auth.note_failure(ip, "register")
        raise _fail(e)
    return await _start_session(request, user)


@router.post("/api/auth/login")
async def login(body: Credentials, request: Request):
    ip, email = auth.client_ip(request), body.email.strip().lower()
    if auth.blocked(ip, email):
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in 15 minutes.")
    try:
        user = await auth.login(_pool(request), email, body.password)
    except auth.AuthError as e:
        auth.note_failure(ip, email)
        raise _fail(e)
    auth.note_success(email)
    return await _start_session(request, user)


@router.post("/api/auth/logout")
async def logout(request: Request):
    await auth.end_session(_pool(request), request.cookies.get(auth.COOKIE))
    resp = JSONResponse({"ok": True})
    auth.clear_cookie(resp)
    return resp


@router.post("/api/auth/password")
async def change_password(body: PasswordChange, request: Request):
    user = await _need_user(request)
    if user["id"] == 0:
        raise HTTPException(status_code=400, detail="Login is switched off (AUTH_REQUIRED=0).")
    try:
        await auth.change_password(_pool(request), user["id"], body.current_password, body.new_password, request.cookies.get(auth.COOKIE))
    except auth.AuthError as e:
        raise _fail(e)
    return {"ok": True, "message": "Password changed. Other devices were signed out."}


# ───────────── profile ─────────────
@router.get("/api/profile")
async def get_profile(request: Request):
    return {"user": await _need_user(request)}


@router.patch("/api/profile")
async def patch_profile(body: ProfilePatch, request: Request):
    user = await _need_user(request)
    if user["id"] == 0:
        raise HTTPException(status_code=400, detail="Login is switched off (AUTH_REQUIRED=0).")
    pool = _pool(request)
    try:
        email = auth.clean_email(body.email) if body.email is not None else None
        if email and email != user["email"]:
            if not await auth.verify_user_password(pool, user["id"], body.password or ""):
                raise auth.AuthError(403, "Enter your current password to change the email.")
            async with pool.acquire() as conn:
                if await conn.fetchval("SELECT 1 FROM users WHERE email = $1 AND id <> $2", email, user["id"]):
                    raise auth.AuthError(400, "That email cannot be used.")
        name = body.display_name.strip()[:80] if body.display_name is not None else None
    except auth.AuthError as e:
        raise _fail(e)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE users SET email = COALESCE($2, email), display_name = COALESCE($3, display_name) WHERE id = $1 "
            "RETURNING id, email, display_name, is_owner", user["id"], email, name)
    return {"user": auth._user(row)}


async def settings_view(pool) -> dict:
    on = await enabled_strategies(pool)
    return {"signups_open": await auth.signups_open(pool), "live_allowed": await live_allowed(pool), "call_rule": await call_rule(pool),
            "strategies": [{"id": i, "weight": w, "enabled": i in on} for i, w in strategy_vote.STRATEGIES.items()]}


@router.get("/api/profile/settings")
async def get_settings(request: Request):
    await _need_user(request)
    return await settings_view(_pool(request))


@router.patch("/api/profile/settings")
async def patch_settings(body: SettingsPatch, request: Request):
    user = await _need_owner(request)
    pool = _pool(request)
    if body.strategies_enabled is not None or body.call_rule is not None:
        ids = [i for i in all_strategy_ids() if i in set(body.strategies_enabled)] if body.strategies_enabled is not None else await enabled_strategies(pool)
        rule = body.call_rule or await call_rule(pool)
        bad = rule_problem(ids, rule)
        if bad:
            raise HTTPException(status_code=422, detail=bad)
        if body.strategies_enabled is not None:
            await auth.set_setting(pool, "profile.strategies_enabled", json.dumps(ids))
            _cache["enabled"] = ids
        if body.call_rule is not None:
            await auth.set_setting(pool, "profile.call_rule", rule)
            _cache["rule"] = rule
    if body.signups_open is not None:
        await auth.set_setting(pool, "profile.signups_open", "1" if body.signups_open else "0")
    if body.live_allowed is not None:
        if body.live_allowed:
            if auth.required() and not await auth.verify_user_password(pool, user["id"], body.password or ""):
                raise HTTPException(status_code=403, detail="Enter your account password to allow live (real-money) trading.")
        elif hooks.get("live_off"):
            hooks["live_off"]()                         # turning the permission off also switches any running live mode off
        await auth.set_setting(pool, "profile.live_allowed", "1" if body.live_allowed else "0")
        _cache["live"] = bool(body.live_allowed)
    return await settings_view(pool)


# ───────────── AI provider keys ─────────────
class AiKeyBody(BaseModel):
    key: Optional[str] = Field(default=None, max_length=400)
    model: Optional[str] = Field(default=None, max_length=80)


class AiActive(BaseModel):
    provider: str = Field(max_length=20)


def _provider(name: str) -> str:
    if name not in ai_providers.PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown AI provider.")
    return name


async def _models(pool) -> dict:
    try:
        d = json.loads(await auth.get_setting(pool, "profile.ai_models", "{}"))
        return d if isinstance(d, dict) else {}
    except ValueError:
        return {}


async def active_ai_provider(pool) -> str:
    p = await auth.get_setting(pool, "profile.ai_provider", "anthropic")
    return p if p in ai_providers.PROVIDERS else "anthropic"


async def _stored_key(pool, provider: str) -> tuple:
    """(plaintext key or None, problem text or None). A key made with another APP_SECRET_KEY reads as a problem, not a crash."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT ciphertext, last4 FROM ai_keys WHERE provider = $1 ORDER BY updated_at DESC LIMIT 1", provider)
    if not row:
        return None, None
    if not crypto.configured():
        return None, "APP_SECRET_KEY missing"
    key = crypto.decrypt(row["ciphertext"])
    return (key, None) if key else (None, "re-enter key (secret changed)")


async def resolve_ai(pool) -> tuple:
    """(provider, key, model) for the next AI request: the active provider's saved key, else (Anthropic only) the server's own key."""
    provider = await active_ai_provider(pool)
    key, _problem = await _stored_key(pool, provider)
    key = key or ai_providers.env_key(provider)
    if not key:
        raise HTTPException(status_code=503, detail=f"No API key for {ai_providers.PROVIDERS[provider]['label']}. Add one in Profile > AI API keys"
                                                    + (" (or set ANTHROPIC_API_KEY in backend/.env)." if provider == "anthropic" else "."))
    model = (await _models(pool)).get(provider) or ai_providers.default_model(provider)
    return provider, key, model


@router.get("/api/profile/ai-keys")
async def get_ai_keys(request: Request):
    await _need_owner(request)
    pool = _pool(request)
    models, out = await _models(pool), []
    async with pool.acquire() as conn:
        rows = {r["provider"]: r for r in await conn.fetch("SELECT provider, last4 FROM ai_keys ORDER BY updated_at")}
    for pid, meta in ai_providers.PROVIDERS.items():
        key, problem = await _stored_key(pool, pid) if pid in rows else (None, None)
        out.append({"provider": pid, "label": meta["label"], "set": pid in rows and key is not None, "masked": crypto.mask(rows[pid]["last4"]) if pid in rows else "",
                    "problem": problem, "model": models.get(pid, ""), "default_model": ai_providers.default_model(pid), "key_hint": meta["key_hint"],
                    "env_fallback": bool(ai_providers.env_key(pid)) and pid not in rows})
    return {"active": await active_ai_provider(pool), "secret_ready": crypto.configured(), "providers": out}


@router.put("/api/profile/ai-keys/{provider}")
async def put_ai_key(provider: str, body: AiKeyBody, request: Request):
    user = await _need_owner(request)
    provider = _provider(provider)
    pool = _pool(request)
    try:
        model = ai_providers.clean_model(body.model)
    except ai_providers.AIError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    key = (body.key or "").strip()
    if key:
        if len(key) < 8 or re.search(r"\s", key):
            raise HTTPException(status_code=400, detail="That does not look like an API key (no spaces, at least 8 characters).")
        if not crypto.configured():
            raise HTTPException(status_code=400, detail="The server has no APP_SECRET_KEY, so keys cannot be stored. Add it to backend/.env and restart.")
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO ai_keys (user_id, provider, ciphertext, last4) VALUES ($1, $2, $3, $4) "
                "ON CONFLICT (user_id, provider) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, last4 = EXCLUDED.last4, updated_at = NOW()",
                user["id"], provider, crypto.encrypt(key), crypto.last4(key))
    models = await _models(pool)
    if model:
        models[provider] = model
    else:
        models.pop(provider, None)
    await auth.set_setting(pool, "profile.ai_models", json.dumps(models))
    return {"ok": True}


@router.delete("/api/profile/ai-keys/{provider}")
async def delete_ai_key(provider: str, request: Request):
    await _need_owner(request)
    provider = _provider(provider)
    async with _pool(request).acquire() as conn:
        await conn.execute("DELETE FROM ai_keys WHERE provider = $1", provider)
    return {"ok": True}


@router.put("/api/profile/ai-active")
async def put_ai_active(body: AiActive, request: Request):
    await _need_owner(request)
    await auth.set_setting(_pool(request), "profile.ai_provider", _provider(body.provider))
    return {"ok": True, "active": body.provider}


@router.post("/api/profile/ai-keys/{provider}/test")
async def test_ai_key(provider: str, request: Request):
    await _need_owner(request)
    provider = _provider(provider)
    pool = _pool(request)
    key, problem = await _stored_key(pool, provider)
    key = key or ai_providers.env_key(provider)
    if not key:
        return {"ok": False, "error": problem or "No key saved for this provider."}
    model = (await _models(pool)).get(provider) or ai_providers.default_model(provider)
    try:
        reply = await ai_providers.chat(provider, key, model, "Reply with the single word: ok", [{"role": "user", "content": "ping"}], max_tokens=20)
    except ai_providers.AIError as e:
        return {"ok": False, "error": e.message}
    return {"ok": True, "reply": reply.strip()[:60], "model": model}

