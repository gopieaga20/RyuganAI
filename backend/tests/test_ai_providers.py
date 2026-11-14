import asyncio
import os
import sys

import httpx
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ai_providers as ai

REAL_CLIENT = httpx.AsyncClient
MSGS = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}, {"role": "user", "content": "go on"}]


def test_anthropic_request_shape():
    url, h, b = ai.build_request("anthropic", "KEY", "m1", "be brief", MSGS, 500)
    assert url == "https://api.anthropic.com/v1/messages" and h["x-api-key"] == "KEY" and h["anthropic-version"] == "2023-06-01"
    assert b == {"model": "m1", "max_tokens": 500, "system": "be brief", "messages": MSGS}


def test_openai_request_shape_and_token_parameter():
    url, h, b = ai.build_request("openai", "KEY", "gpt-4o-mini", "be brief", MSGS, 500)
    assert url == "https://api.openai.com/v1/chat/completions" and h["authorization"] == "Bearer KEY"
    assert b["messages"][0] == {"role": "system", "content": "be brief"} and b["messages"][1:] == MSGS and b["max_tokens"] == 500 and "max_completion_tokens" not in b
    for newer in ("gpt-5-mini", "o3-mini"):
        b2 = ai.build_request("openai", "KEY", newer, "s", MSGS, 500)[2]
        assert b2["max_completion_tokens"] == 500 and "max_tokens" not in b2


def test_gemini_request_shape_key_only_in_a_header():
    url, h, b = ai.build_request("gemini", "SECRETKEY", "gemini-2.0-flash", "be brief", MSGS, 500)
    assert url == "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
    assert "SECRETKEY" not in url and h["x-goog-api-key"] == "SECRETKEY"
    assert b["systemInstruction"] == {"parts": [{"text": "be brief"}]} and b["generationConfig"] == {"maxOutputTokens": 500}
    assert [c["role"] for c in b["contents"]] == ["user", "model", "user"] and b["contents"][1]["parts"] == [{"text": "hello"}]


def test_bad_model_names_and_providers_are_refused():
    for bad in ("../x", "a/b", "a b", "x" * 100, "-lead"):
        with pytest.raises(ai.AIError):
            ai.clean_model(bad)
    assert ai.clean_model("  ") is None and ai.clean_model("gpt-4o-mini") == "gpt-4o-mini"
    with pytest.raises(ai.AIError):
        ai.build_request("gemini", "k", "../../evil", "s", MSGS)
    with pytest.raises(ai.AIError):
        ai.build_request("nope", "k", "m", "s", MSGS)


def test_replies_are_parsed_per_provider():
    assert ai.parse_reply("anthropic", {"content": [{"type": "text", "text": "a"}, {"type": "tool_use"}, {"type": "text", "text": "b"}]}) == "a\nb"
    assert ai.parse_reply("openai", {"choices": [{"message": {"content": "hey"}}]}) == "hey"
    assert ai.parse_reply("gemini", {"candidates": [{"content": {"parts": [{"text": "x"}, {"text": "y"}]}}]}) == "xy"
    for p in ("anthropic", "openai", "gemini"):
        if p != "anthropic":
            with pytest.raises(ai.AIError):
                ai.parse_reply(p, {"weird": 1})


def _mock(monkeypatch, status, payload):

    def handler(request):
        return httpx.Response(status, json=payload)
    monkeypatch.setattr(ai.httpx, "AsyncClient", lambda **kw: REAL_CLIENT(transport=httpx.MockTransport(handler), **kw))


def test_chat_success_and_provider_errors_never_echo_the_key(monkeypatch):
    _mock(monkeypatch, 200, {"choices": [{"message": {"content": "pong"}}]})
    assert asyncio.run(ai.chat("openai", "KEY", "gpt-4o-mini", "s", MSGS)) == "pong"
    _mock(monkeypatch, 401, {"error": {"message": "Incorrect API key provided: sk-SECRET-1234"}})
    with pytest.raises(ai.AIError) as e:
        asyncio.run(ai.chat("openai", "sk-SECRET-1234", "gpt-4o-mini", "s", MSGS))
    assert e.value.status == 502 and "sk-SECRET-1234" not in e.value.message          # their 401 is not our 401
    _mock(monkeypatch, 429, {"error": {"message": "slow down"}})
    with pytest.raises(ai.AIError) as e:
        asyncio.run(ai.chat("anthropic", "KEY", "m", "s", MSGS))
    assert e.value.status == 429


def test_only_anthropic_has_a_server_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-env")
    assert ai.env_key("anthropic") == "sk-env" and ai.env_key("openai") == "" and ai.env_key("gemini") == ""
