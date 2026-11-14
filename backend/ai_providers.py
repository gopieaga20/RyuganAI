"""One chat call, three providers (Anthropic, OpenAI, Gemini). The key is passed in by the caller and is only ever sent in a request header:
never put in a URL, never logged, never returned. build_request / parse_reply are pure so the request shapes are unit-tested."""
from __future__ import annotations

import os
import re
from typing import Optional

import httpx

TIMEOUT = 30.0
MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$")          # a model name is a path segment for Gemini: keep it plain

PROVIDERS = {
    "anthropic": {"label": "Anthropic (Claude)", "default_model": "claude-sonnet-5-5", "key_hint": "sk-ant-…"},
    "openai": {"label": "OpenAI (GPT)", "default_model": "gpt-4o-mini", "key_hint": "sk-…"},
    "gemini": {"label": "Google (Gemini)", "default_model": "gemini-2.0-flash", "key_hint": "AIza…"},
}


class AIError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def default_model(provider: str) -> str:
    """ANTHROPIC_MODEL in backend/.env overrides the built-in Anthropic default (read at call time: .env is loaded after imports)."""
    if provider == "anthropic":
        return os.getenv("ANTHROPIC_MODEL", "").strip() or PROVIDERS["anthropic"]["default_model"]
    return PROVIDERS[provider]["default_model"]


def env_key(provider: str) -> str:
    """Only Anthropic has a server-wide fallback key (ANTHROPIC_API_KEY in backend/.env)."""
    return os.getenv("ANTHROPIC_API_KEY", "").strip() if provider == "anthropic" else ""


def clean_model(model: Optional[str]) -> Optional[str]:
    m = (model or "").strip()
    if not m:
        return None
    if not MODEL_RE.match(m):
        raise AIError(400, "That model name has characters that are not allowed.")
    return m


def build_request(provider: str, key: str, model: str, system: str, messages: list, max_tokens: int = 1200) -> tuple:
    """(url, headers, json_body) for one chat call. `messages` are [{role: 'user'|'assistant', content}]."""
    if provider == "anthropic":
        return ("https://api.anthropic.com/v1/messages",
                {"content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"},
                {"model": model, "max_tokens": max_tokens, "system": system, "messages": messages})
    if provider == "openai":
        body = {"model": model, "messages": [{"role": "system", "content": system}] + messages}
        # newer reasoning-style models only accept max_completion_tokens
        body["max_completion_tokens" if re.match(r"^(o\d|gpt-5)", model) else "max_tokens"] = max_tokens
        return ("https://api.openai.com/v1/chat/completions", {"content-type": "application/json", "authorization": f"Bearer {key}"}, body)
    if provider == "gemini":
        if not MODEL_RE.match(model):
            raise AIError(400, "Invalid model name.")
        return (f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                {"content-type": "application/json", "x-goog-api-key": key},
                {"systemInstruction": {"parts": [{"text": system}]},
                 "contents": [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]} for m in messages],
                 "generationConfig": {"maxOutputTokens": max_tokens}})
    raise AIError(400, "Unknown AI provider.")


def parse_reply(provider: str, data: dict) -> str:
    try:
        if provider == "anthropic":
            return "\n".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
        if provider == "openai":
            return data["choices"][0]["message"]["content"] or ""
        if provider == "gemini":
            return "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
    except (KeyError, IndexError, TypeError):
        pass
    raise AIError(502, "The AI provider sent an answer in an unexpected shape.")


def _error_text(r: httpx.Response, key: str) -> str:
    try:
        j = r.json()
        err = j.get("error", j)
        msg = err.get("message") if isinstance(err, dict) else str(err)
    except ValueError:
        msg = r.text
    msg = (msg or f"HTTP {r.status_code}")[:300]
    return msg.replace(key, "…") if key else msg                    # never echo the key back, even if the provider does


async def chat(provider: str, key: str, model: str, system: str, messages: list, max_tokens: int = 1200) -> str:
    url, headers, body = build_request(provider, key, model, system, messages, max_tokens)
    label = PROVIDERS[provider]["label"]
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        try:
            r = await client.post(url, headers=headers, json=body)
        except httpx.TimeoutException:
            raise AIError(504, f"{label} request timed out")
        except httpx.HTTPError:
            raise AIError(502, f"Cannot reach {label}")
    if r.status_code != 200:
        # 401/403 from the provider means THEIR rejection of the key: never pass it on as our own 401 (the browser would show the login screen)
        raise AIError(502 if (r.status_code >= 500 or r.status_code in (401, 403)) else r.status_code, f"{label}: {_error_text(r, key)}")
    return parse_reply(provider, r.json())
