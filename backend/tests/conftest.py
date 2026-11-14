"""Login is switched off for the existing tests (they call the API without a session cookie).
test_auth.py switches it back on, per test, with monkeypatch.setenv("AUTH_REQUIRED", "1")."""
import os

os.environ.setdefault("AUTH_REQUIRED", "0")
