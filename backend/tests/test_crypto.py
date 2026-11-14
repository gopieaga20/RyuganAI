import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import crypto


def test_round_trip_and_nothing_readable_in_the_ciphertext(monkeypatch):
    monkeypatch.setenv("APP_SECRET_KEY", "a-long-random-test-secret-value")
    token = crypto.encrypt("sk-live-abcdef123456")
    assert "abcdef" not in token and crypto.decrypt(token) == "sk-live-abcdef123456"
    assert crypto.encrypt("x") != crypto.encrypt("x")                       # fresh nonce each time


def test_wrong_secret_or_garbage_reads_as_none_not_an_exception(monkeypatch):
    monkeypatch.setenv("APP_SECRET_KEY", "a-long-random-test-secret-value")
    token = crypto.encrypt("hello world")
    monkeypatch.setenv("APP_SECRET_KEY", "another-long-random-secret-value")
    assert crypto.decrypt(token) is None and crypto.decrypt("not a token") is None


def test_missing_or_short_secret_is_refused_with_a_clear_message(monkeypatch):
    for v in (None, "", "short"):
        if v is None:
            monkeypatch.delenv("APP_SECRET_KEY", raising=False)
        else:
            monkeypatch.setenv("APP_SECRET_KEY", v)
        assert crypto.configured() is False
        with pytest.raises(crypto.SecretKeyMissing, match="APP_SECRET_KEY"):
            crypto.encrypt("x")


def test_mask():
    assert crypto.last4("sk-ant-abcdefgh1234") == "1234" and crypto.last4("short") == ""
    assert crypto.mask("1234") == "…1234" and crypto.mask("") == "set"
