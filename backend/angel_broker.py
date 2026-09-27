"""
Angel One SmartAPI Broker Integration
- LTP fetching for live prices (replaces Yahoo Finance for spot quotes)
- Historical OHLCV candlestick data for backtesting
- Auto session management with TOTP refresh on expiry
"""
import os
import re
import urllib.request
import json
import pyotp # type: ignore
from datetime import datetime, timedelta

# ── Module-level singletons ───────────────────────────────────────────────────
_angel_obj = None          # SmartConnect instance (stateful session)
_auth_token = None         # JWT session token
_feed_token = None         # WebSocket feed token
_master_lookup = {}        # symbol -> {exch, token}
_is_loaded = False
_nse_equities = []         # [{symbol, name}, ...] — all NSE cash-market equities
_options_index = {}        # underlying name -> [{symbol, token, expiry, strike, type}, ...]

# ── Session management ────────────────────────────────────────────────────────

def _get_credentials():
    api_key    = os.getenv("ANGEL_API_KEY", "").strip().strip('"')
    client_code= os.getenv("ANGEL_CLIENT_CODE", "").strip().strip('"')
    password   = os.getenv("ANGEL_PASSWORD", "").strip().strip('"')
    totp_secret= os.getenv("ANGEL_TOTP_SECRET", "").strip().strip('"')
    return api_key, client_code, password, totp_secret

def get_angel_client():
    """Return an authenticated SmartConnect object, creating/refreshing as needed."""
    global _angel_obj, _auth_token, _feed_token

    api_key, client_code, password, totp_secret = _get_credentials()
    if not all([api_key, client_code, password, totp_secret]):
        return None

    # Already have a session — return it
    if _angel_obj and _auth_token:
        return _angel_obj

    try:
        from SmartApi import SmartConnect # type: ignore
        obj = SmartConnect(api_key=api_key)
        totp = pyotp.TOTP(totp_secret).now()
        data = obj.generateSession(client_code, password, totp)
        if not data or not data.get("status"):
            print("Angel SmartAPI login failed:", data)
            return None

        _angel_obj  = obj
        _auth_token = data["data"]["jwtToken"]
        _feed_token = data["data"].get("feedToken", "")
        print("Angel SmartAPI: logged in successfully.")
        return _angel_obj
    except Exception as e:
        print("Angel SmartAPI init error:", e)
        return None

def invalidate_session():
    """Call this when a session-expired error is detected to force re-login."""
    global _angel_obj, _auth_token, _feed_token
    _angel_obj = _auth_token = _feed_token = None

# ── Scrip master ──────────────────────────────────────────────────────────────

def load_master_contract():
    """Download Angel One's scrip master JSON and build in-memory lookup tables.
    This is a plain public file download — it needs no login/API key, so it works
    even when the Angel trading session itself is unavailable."""
    global _is_loaded, _master_lookup, _nse_equities, _options_index
    if _is_loaded:
        return
    try:
        print("Downloading Angel OpenAPIScripMaster.json...")
        url = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        equities = []
        options = {}
        # Build lookup keyed by symbol string (uppercase), only NSE/NFO
        for item in data:
            exch = item.get("exch_seg", "")
            if exch in ("NSE", "NFO"):
                sym = str(item.get("symbol", "")).strip()
                _master_lookup[sym] = {
                    "exch": exch,
                    "token": str(item.get("token", "")),
                    "name": item.get("name", sym),
                }
                if exch == "NSE" and sym.endswith("-EQ"):
                    equities.append({"symbol": sym[:-3], "name": item.get("name", sym[:-3])})

                instrument = item.get("instrumenttype", "")
                if exch == "NFO" and instrument in ("OPTIDX", "OPTSTK"):
                    opt_type = "CE" if sym.endswith("CE") else "PE" if sym.endswith("PE") else None
                    try:
                        strike = float(item.get("strike", "-1")) / 100.0
                    except (TypeError, ValueError):
                        strike = None
                    if opt_type and strike and strike > 0:
                        name = item.get("name", "")
                        options.setdefault(name, []).append({
                            "symbol": sym,
                            "token": str(item.get("token", "")),
                            "expiry": item.get("expiry", ""),
                            "strike": strike,
                            "type": opt_type,
                        })

        equities.sort(key=lambda e: e["symbol"])
        _nse_equities = equities
        _options_index = options
        _is_loaded = True
        print(f"Angel Scrip Master loaded: {len(_master_lookup)} symbols, {len(_nse_equities)} NSE equities, {len(_options_index)} F&O underlyings.")
    except Exception as e:
        print(f"Failed to load Angel Scrip Master: {e}")


def get_nse_equities():
    """Return the full list of NSE cash-market equities: [{symbol, name}, ...]."""
    load_master_contract()
    return _nse_equities


def get_option_contracts(underlying: str):
    """Return all option contracts for an F&O underlying (e.g. 'NIFTY', 'RELIANCE'):
    [{symbol, token, expiry, strike, type}, ...], or [] if the underlying has no F&O."""
    load_master_contract()
    return _options_index.get(underlying.strip().upper(), [])

# ── Symbol mapping ────────────────────────────────────────────────────────────

_STATIC_MAP = {
    "^NSEI":       "NIFTY",
    "NIFTY 50":    "NIFTY",
    "^NSEBANK":    "BANKNIFTY",
    "BANK NIFTY":  "BANKNIFTY",
    "^NSEMDCP50":  "FINNIFTY",
    "FINNIFTY":    "FINNIFTY",
    "^BSESN":      "SENSEX",
    "^INDIAVIX":   "INDIA VIX",
}

_OPT_RE = re.compile(
    r"^(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY)\s+(\d{1,2})\s+([A-Z]{3})\s+(\d+)\s+(CE|PE)$",
    re.IGNORECASE,
)

def _map_symbol(sym: str) -> str:
    """Convert frontend display strings to Angel One trading symbol format."""
    up = sym.upper()

    # Direct static substitutions
    if up in _STATIC_MAP:
        return _STATIC_MAP[up]

    # Equity: RELIANCE.NS → RELIANCE-EQ
    if up.endswith(".NS"):
        return up.removesuffix(".NS") + "-EQ"

    # Options: NIFTY 24 MAR 23100 CE → NIFTY24MAR23100CE (without year, fuzzy)
    m = _OPT_RE.match(up)
    if m:
        name, day, month, strike, opt = m.groups()
        day = day.zfill(2)
        return f"{name}{day}{month}{strike}{opt}"

    return up

def _lookup_with_fuzzy(symbol: str):
    """Try direct lookup, then fuzzy regex scan for option symbols."""
    mapped = _map_symbol(symbol)
    info = _master_lookup.get(mapped)
    if info:
        return mapped, info

    # Fuzzy scan: e.g. NIFTY24MAR23100CE may appear as NIFTY24MAR2623100CE in master
    m = _OPT_RE.match(symbol.upper())
    if m:
        name, day, month, strike, opt = m.groups()
        day = day.zfill(2)
        # pattern: NAME + DAY + MONTH + (any year digits) + STRIKE + OPT
        pattern = re.compile(rf"^{name}{day}{month}\d*{strike}{opt}$")
        for k, v in _master_lookup.items():
            if pattern.match(k):
                return k, v

    return None, None

# ── LTP fetching ──────────────────────────────────────────────────────────────

def get_quote(symbol: str):
    """
    Fetch the Last Traded Price for a symbol from Angel One.
    Returns a Yahoo Finance-compatible chart JSON dict, or None to trigger Yahoo fallback.
    """
    client = get_angel_client()
    if not client:
        return None

    load_master_contract()

    mapped_sym, info = _lookup_with_fuzzy(symbol)
    if not info:
        return None

    try:
        res = client.ltpData(
            exchange=info["exch"],
            tradingsymbol=mapped_sym,
            symboltoken=info["token"],
        )
        if not (res and res.get("status") and res.get("data")):
            # Session may have expired — invalidate so next call re-logs in
            if res and "Session Expired" in str(res):
                invalidate_session()
            return None

        d = res["data"]
        ltp = float(d.get("ltp", 0) or 0)
        pc  = float(d.get("close", ltp) or ltp)
        if not ltp:
            return None

        # Return shape that matches yahooFetch() expectation in the frontend
        return {
            "chart": {
                "result": [{
                    "meta": {
                        "regularMarketPrice": ltp,
                        "chartPreviousClose": pc,
                    }
                }]
            }
        }
    except Exception as e:
        print(f"Angel get_quote error for '{symbol}': {e}")
        if "Session" in str(e):
            invalidate_session()
        return None

# ── Historical OHLCV (for backtesting) ───────────────────────────────────────

_ANGEL_INTERVAL_MAP = {
    "1m":  "ONE_MINUTE",
    "5m":  "FIVE_MINUTE",
    "15m": "FIFTEEN_MINUTE",
    "30m": "THIRTY_MINUTE",
    "1h":  "ONE_HOUR",
    "1d":  "ONE_DAY",
    "1wk": "ONE_WEEK",
}

def get_historical(symbol: str, interval: str = "15m", days: int = 90):
    """
    Fetch historical OHLCV candlestick data from Angel One getCandleData API.
    Returns list of dicts: [{t, o, h, l, c, v}, …] sorted ascending by time.
    Returns None on failure — caller should fall back to Yahoo Finance.

    Args:
        symbol:   Frontend symbol string, e.g. "^NSEI", "RELIANCE.NS", "NIFTY 24 MAR 23100 CE"
        interval: Candle interval — "1m","5m","15m","30m","1h","1d","1wk"
        days:     Number of calendar days of history to fetch (max 365 for intraday)
    """
    client = get_angel_client()
    if not client:
        return None

    load_master_contract()

    mapped_sym, info = _lookup_with_fuzzy(symbol)
    if not info:
        return None

    angel_interval = _ANGEL_INTERVAL_MAP.get(interval)
    if not angel_interval:
        print(f"Unsupported interval for Angel One: {interval}")
        return None

    now   = datetime.now()
    from_dt = now - timedelta(days=days)
    from_str = from_dt.strftime("%Y-%m-%d %H:%M")
    to_str   = now.strftime("%Y-%m-%d %H:%M")

    try:
        res = client.getCandleData(
            historicDataParams={
                "exchange": info["exch"],
                "symboltoken": info["token"],
                "interval": angel_interval,
                "fromdate": from_str,
                "todate": to_str,
            }
        )
        if not (res and res.get("status") and res.get("data")):
            if res and "Session" in str(res):
                invalidate_session()
            return None

        candles = []
        for row in res["data"]:
            # Angel returns: [timestamp_str, open, high, low, close, volume]
            try:
                ts = int(datetime.fromisoformat(str(row[0])).timestamp())
                candles.append({
                    "t": ts,
                    "o": float(row[1]),
                    "h": float(row[2]),
                    "l": float(row[3]),
                    "c": float(row[4]),
                    "v": int(row[5]),
                })
            except Exception:
                continue

        return candles if candles else None
    except Exception as e:
        print(f"Angel get_historical error for '{symbol}': {e}")
        if "Session" in str(e):
            invalidate_session()
        return None
