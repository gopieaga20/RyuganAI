"""Encryption for secrets stored in the database (the AI provider API keys).

The key comes from APP_SECRET_KEY in the environment (any long random string). It is never stored. If it is lost, the stored keys
cannot be read any more: decrypt() returns None and the UI asks the user to enter the key again, it never crashes a request.
"""
from __future__ import annotations

import base64
import hashlib
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

MIN_SECRET_LEN = 16


class SecretKeyMissing(RuntimeError):
    pass


def configured() -> bool:
    return len(os.getenv("APP_SECRET_KEY", "").strip()) >= MIN_SECRET_LEN


def _fernet() -> Fernet:
    secret = os.getenv("APP_SECRET_KEY", "").strip()
    if len(secret) < MIN_SECRET_LEN:
        raise SecretKeyMissing(f"APP_SECRET_KEY must be set in backend/.env (at least {MIN_SECRET_LEN} characters) to store API keys")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(b"ryugan-secrets|" + secret.encode()).digest()))


def encrypt(text: str) -> str:
    return _fernet().encrypt(text.encode()).decode()


def decrypt(token: str) -> Optional[str]:
    """The original text, or None when the token was made with another secret or is damaged."""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        return None


def last4(key: str) -> str:
    return key[-4:] if len(key) >= 8 else ""


def mask(last: str) -> str:
    return ("…" + last) if last else "set"
