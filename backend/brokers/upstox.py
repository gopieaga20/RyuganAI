"""Upstox behind the broker interface.

Login is Upstox's own OAuth 2 page (like TradingView): the user signs in on Upstox, which redirects back with a one-time `code`;
the server exchanges it for an access token (valid until about 03:30 IST the next day, so Connect is pressed once each morning).
The app key and secret stay in the server .env (UPSTOX_API_KEY, UPSTOX_API_SECRET, UPSTOX_REDIRECT_URI); the user's password is
typed only on Upstox's site.

Orders are addressed by Upstox's `instrument_key` (e.g. NSE_FO|12345), not by the app's Angel-style option symbol, so the adapter
loads Upstox's public instruments file and maps (underlying, expiry, strike, CE/PE) to the key, and maps keys back to the app's
symbols so positions and orders line up with what the rest of the app uses.

NOTE: written from Upstox's public API documentation and not yet run against the real service. Check it on Upstox's sandbox
(see ARCHITECTURE.md) before any real order.
"""
import datetime as dt
import gzip
import json
import os
import re
import threading
import time
from typing import Optional
from urllib.parse import urlencode

import httpx

from .base import Broker

API = "https://api.upstox.com/v2"
AUTH_DIALOG = f"{API}/login/authorization/dialog"
TOKEN_URL = f"{API}/login/authorization/token"
INSTRUMENTS_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
TIMEOUT = httpx.Timeout(10.0, connect=5.0)

PRODUCT = {"INTRADAY": "I", "CARRYFORWARD": "D"}
PRODUCT_BACK = {"I": "INTRADAY", "D": "CARRYFORWARD", "MIS": "INTRADAY", "NRML": "CARRYFORWARD"}
ORDER_TYPE = {"LIMIT": "LIMIT", "MARKET": "MARKET", "STOPLOSS_LIMIT": "SL", "STOPLOSS_MARKET": "SL-M"}
ORDER_TYPE_BACK = {v: k for k, v in ORDER_TYPE.items()}
OPEN_STATES = ("open", "pending", "trigger pending", "validation pending", "open pending", "modify pending", "modify validation pending",
               "put order req received", "after market order req received")
OPT_RE = re.compile(r"^(.+?)(\d{2})([A-Z]{3})(\d{2})(\d+)(CE|PE)$")
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def _num(v) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_symbol(symbol: str) -> Optional[tuple]:
    """NIFTY10NOV2623950CE -> ('NIFTY', date(2026, 11, 10), 23950, 'CE'), or None."""
    m = OPT_RE.match(symbol.upper())
    if not m or m.group(3) not in MONTHS:
        return None
    try:
        return m.group(1), dt.date(2000 + int(m.group(4)), MONTHS.index(m.group(3)) + 1, int(m.group(2))), int(m.group(5)), m.group(6)
    except ValueError:
        return None


def app_symbol(und: str, expiry: dt.date, strike, opt: str) -> str:
    return f"{und}{expiry.day:02d}{MONTHS[expiry.month - 1]}{expiry.year % 100:02d}{int(strike)}{opt}"


def next_expiry_of_token(now: Optional[dt.datetime] = None) -> float:
    """Upstox access tokens stop working at 03:30 IST: the next 03:30 after `now`."""
    now = now or dt.datetime.now(IST)
    t = now.replace(hour=3, minute=30, second=0, microsecond=0)
    if t <= now:
        t += dt.timedelta(days=1)
    return t.timestamp()


class UpstoxBroker(Broker):
    id = "upstox"
    label = "Upstox"
    login = "oauth"

    def __init__(self):
        self._token: Optional[str] = None
        self._account: Optional[str] = None
        self._expires: Optional[float] = None
        self._lock = threading.Lock()
        self._index: dict = {}              # (underlying, expiry date, strike, CE/PE) -> instrument
        self._back: dict = {}               # instrument_key -> app symbol
        self._index_at = 0.0
        self._http = httpx.Client(timeout=TIMEOUT)

    # ───────────── connection ─────────────
    def _cfg(self) -> tuple:
        return (os.getenv("UPSTOX_API_KEY", "").strip(), os.getenv("UPSTOX_API_SECRET", "").strip(), os.getenv("UPSTOX_REDIRECT_URI", "").strip())

    def configured(self) -> bool:
        return all(self._cfg())

    def connected(self) -> bool:
        return bool(self._token and self._expires and self._expires > time.time())

    def status(self) -> dict:
        if not self.configured():
            msg = "Add UPSTOX_API_KEY, UPSTOX_API_SECRET and UPSTOX_REDIRECT_URI to the server .env, then restart."
        elif self._token and not self.connected():
            msg = "The Upstox session has expired. Press Connect again."
        elif not self._token:
            msg = "Not connected. Press Connect and sign in on the Upstox page."
        else:
            msg = ""
        return {"id": self.id, "label": self.label, "login": self.login, "configured": self.configured(), "connected": self.connected(),
                "account": self._account, "expires": self._expires, "message": msg}

    def login_url(self, state: str) -> str:
        key, _, redirect = self._cfg()
        if not self.configured():
            raise RuntimeError("Upstox is not set up on the server (UPSTOX_API_KEY, UPSTOX_API_SECRET, UPSTOX_REDIRECT_URI).")
        return AUTH_DIALOG + "?" + urlencode({"client_id": key, "redirect_uri": redirect, "response_type": "code", "state": state})

    def complete_login(self, params: dict) -> dict:
        code = (params.get("code") or "").strip()
        if not code:
            raise ValueError("Upstox did not send a login code. Try Connect again.")
        key, secret, redirect = self._cfg()
        r = self._http.post(TOKEN_URL, data={"code": code, "client_id": key, "client_secret": secret, "redirect_uri": redirect,
                                             "grant_type": "authorization_code"},
                            headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"})
        body = r.json() if r.content else {}
        token = body.get("access_token")
        if r.status_code != 200 or not token:
            raise ValueError(_error_text(body) or f"Upstox refused the login (HTTP {r.status_code}).")
        with self._lock:
            self._token = token
            self._account = body.get("user_id") or body.get("user_name")
            self._expires = next_expiry_of_token()
        return self.status()

    def restore(self, token, account, expires_ts) -> None:
        if token and expires_ts and expires_ts > time.time():
            self._token, self._account, self._expires = token, account, expires_ts

    def session_for_storage(self) -> Optional[dict]:
        return {"token": self._token, "account": self._account, "expires_ts": self._expires} if self.connected() else None

    def disconnect(self) -> None:
        with self._lock:
            self._token = self._account = self._expires = None

    # ───────────── http ─────────────
    def _headers(self) -> dict:
        if not self.connected():
            raise RuntimeError("Upstox is not connected. Press Connect on the Live page.")
        return {"Authorization": f"Bearer {self._token}", "Accept": "application/json"}

    def _get(self, path: str, params: Optional[dict] = None) -> dict:
        r = self._http.get(API + path, params=params, headers=self._headers())
        if r.status_code == 401:
            self.disconnect()
            raise RuntimeError("The Upstox session has expired. Press Connect again.")
        body = r.json() if r.content else {}
        if r.status_code != 200 or body.get("status") != "success":
            raise RuntimeError(_error_text(body) or f"Upstox returned HTTP {r.status_code}.")
        return body

    # ───────────── instruments ─────────────
    def set_instruments(self, rows: list) -> None:
        """Index option contracts from Upstox's instrument list (also used by tests with a small sample)."""
        idx, back = {}, {}
        for r in rows:
            if r.get("segment") != "NSE_FO" or r.get("instrument_type") not in ("CE", "PE"):
                continue
            und = str(r.get("underlying_symbol") or r.get("name") or "").upper().replace(" ", "")
            exp = r.get("expiry")
            strike = _num(r.get("strike_price"))
            if not (und and exp and strike is not None and r.get("instrument_key")):
                continue
            day = dt.datetime.fromtimestamp(float(exp) / 1000, IST).date()
            inst = {"token": r["instrument_key"], "exch": "NFO", "lot_size": int(r.get("lot_size") or 0) or None,
                    "trading_symbol": r.get("trading_symbol"), "tick": _num(r.get("tick_size"))}
            idx[(und, day, int(strike), r["instrument_type"])] = inst
            back[r["instrument_key"]] = app_symbol(und, day, strike, r["instrument_type"])
        self._index, self._back, self._index_at = idx, back, time.time()

    def _ensure_instruments(self) -> None:
        if self._index and time.time() - self._index_at < 8 * 3600:
            return
        r = self._http.get(INSTRUMENTS_URL, timeout=httpx.Timeout(90.0, connect=10.0), follow_redirects=True)
        r.raise_for_status()
        self.set_instruments(json.loads(gzip.decompress(r.content)))

    def resolve(self, symbol: str) -> Optional[dict]:
        p = parse_symbol(symbol)
        if not p:
            return None
        try:
            self._ensure_instruments()
        except Exception as e:
            print(f"[WARN] Upstox instrument list not loaded: {e}")
            return None
        und, day, strike, opt = p
        return self._index.get((und, day, strike, opt))

    # ───────────── orders ─────────────
    def build_params(self, o: dict, info: dict, tag: str = "") -> dict:
        otype = o["order_type"]
        return {
            "quantity": int(o["qty"]), "product": PRODUCT[o["product"]], "validity": "DAY",
            "price": 0 if otype in ("MARKET", "STOPLOSS_MARKET") else round(float(o["price"]), 2),
            "tag": tag[:20], "instrument_token": info["token"], "order_type": ORDER_TYPE[otype],
            "transaction_type": o["side"], "disclosed_quantity": 0,
            "trigger_price": round(float(o["trigger_price"]), 2) if otype.startswith("STOPLOSS") else 0, "is_amo": False,
        }

    def place(self, params: dict) -> dict:
        try:
            headers = self._headers()
        except RuntimeError as e:
            return {"state": "NOT_SENT", "message": str(e)}
        try:
            r = self._http.post(f"{API}/order/place", json=params, headers={**headers, "Content-Type": "application/json"})
        except (httpx.ConnectError, httpx.ConnectTimeout) as e:      # the request never reached Upstox: safe to say it was not sent
            return {"state": "NOT_SENT", "message": f"Could not reach Upstox ({type(e).__name__}). Nothing was sent."}
        except Exception as e:                                       # it may have reached the exchange: never retry
            return {"state": "UNKNOWN", "message": f"The request failed after it may have been sent ({type(e).__name__}). Check the order book before doing anything else."}
        try:
            body = r.json() if r.content else {}
        except ValueError:
            body = {}
        if r.status_code == 401:
            self.disconnect()
            return {"state": "NOT_SENT", "message": "The Upstox session has expired. Press Connect again. Nothing was sent."}
        if r.status_code == 429:
            return {"state": "NOT_SENT", "message": "Upstox rate limit reached. Nothing was sent: try again in a moment."}
        if r.status_code == 200 and body.get("status") == "success" and (body.get("data") or {}).get("order_id"):
            return {"state": "PLACED", "order_id": str(body["data"]["order_id"]), "message": "", "raw": body}
        if r.status_code >= 500:                                     # a server error: the order may or may not exist
            return {"state": "UNKNOWN", "message": f"Upstox answered with a server error (HTTP {r.status_code}). Check the order book before doing anything else."}
        return {"state": "REJECTED", "message": _error_text(body) or f"Upstox refused the order (HTTP {r.status_code}).", "raw": body}

    def cancel(self, order_id: str, variety: str = "NORMAL") -> dict:
        try:
            r = self._http.delete(f"{API}/order/cancel", params={"order_id": order_id}, headers=self._headers())
            body = r.json() if r.content else {}
        except Exception as e:
            return {"ok": False, "message": str(e), "raw": None}
        ok = r.status_code == 200 and body.get("status") == "success"
        return {"ok": ok, "message": "" if ok else (_error_text(body) or f"HTTP {r.status_code}"), "raw": body}

    def _symbol_of(self, row: dict) -> str:
        return self._back.get(row.get("instrument_token") or row.get("instrument_key") or "") or row.get("trading_symbol") or ""

    def order_book(self) -> list:
        try:
            self._ensure_instruments()
        except Exception:
            pass
        return [self.normalize_order(r) for r in (self._get("/order/retrieve-all").get("data") or [])]

    def positions(self) -> list:
        try:
            self._ensure_instruments()
        except Exception:
            pass
        return [self.normalize_position(r) for r in (self._get("/portfolio/short-term-positions").get("data") or [])]

    def funds(self) -> Optional[dict]:
        eq = (self._get("/user/get-funds-and-margin", {"segment": "SEC"}).get("data") or {}).get("equity") or {}
        if not eq:
            return None
        avail = _num(eq.get("available_margin"))
        return {"available_cash": avail, "net": avail, "utilised": _num(eq.get("used_margin")), "available_margin": avail, "raw": eq}

    def ltp(self, symbol: str) -> Optional[float]:
        info = self.resolve(symbol)
        if not info or not self.connected():
            return None
        try:
            data = self._get("/market-quote/ltp", {"instrument_key": info["token"]}).get("data") or {}
        except Exception:
            return None
        for v in data.values():
            p = _num((v or {}).get("last_price"))
            if p:
                return p
        return None

    # ───────────── normalizing ─────────────
    def normalize_order(self, r: dict) -> dict:
        status = str(r.get("status") or "").lower()
        otype = ORDER_TYPE_BACK.get(str(r.get("order_type") or "").upper(), r.get("order_type"))
        return {
            "order_id": str(r.get("order_id") or ""), "symbol": self._symbol_of(r), "side": r.get("transaction_type"), "order_type": otype,
            "product": PRODUCT_BACK.get(str(r.get("product") or "").upper(), r.get("product")), "variety": "NORMAL",
            "qty": int(_num(r.get("quantity")) or 0), "filled": int(_num(r.get("filled_quantity")) or 0),
            "price": _num(r.get("price")), "trigger": _num(r.get("trigger_price")), "avg_price": _num(r.get("average_price")),
            "status": status, "text": r.get("status_message") or r.get("status_message_raw") or "",
            "time": str(r.get("order_timestamp") or ""), "open": status in OPEN_STATES,
        }

    def normalize_position(self, r: dict) -> dict:
        return {
            "symbol": self._symbol_of(r), "exchange": r.get("exchange"), "product": PRODUCT_BACK.get(str(r.get("product") or "").upper(), r.get("product")),
            "net_qty": int(_num(r.get("quantity")) or 0), "buy_qty": int(_num(r.get("day_buy_quantity")) or 0),
            "sell_qty": int(_num(r.get("day_sell_quantity")) or 0), "buy_avg": _num(r.get("buy_price")), "sell_avg": _num(r.get("sell_price")),
            "ltp": _num(r.get("last_price")), "pnl": _num(r.get("pnl")), "realised": _num(r.get("realised")), "unrealised": _num(r.get("unrealised")),
            "token": r.get("instrument_token"),
        }


def _error_text(body) -> str:
    """The first readable error in an Upstox reply (their errors come as {"errors": [{"message": ...}]} or {"message": ...})."""
    if not isinstance(body, dict):
        return ""
    errs = body.get("errors")
    if isinstance(errs, list) and errs and isinstance(errs[0], dict):
        return str(errs[0].get("message") or errs[0].get("errorCode") or "")
    return str(body.get("message") or body.get("error_description") or body.get("error") or "")
