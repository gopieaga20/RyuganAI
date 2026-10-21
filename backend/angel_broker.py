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
import threading
import time
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
_lot_sizes = {}            # F&O underlying name -> contract lot size (e.g. NIFTY -> 65)
# The SDK is synchronous and the API calls it from worker threads, so login and the one-time
# master-contract download must not run twice concurrently.
_lock = threading.RLock()
_master_lock = threading.Lock()   # separate: a slow download must never block Angel login / quotes
_MASTER_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
# The file is ~7 MB and Angel's server can take well over a minute to send it, so keep a copy on disk
# (reused for a day; a stale copy still beats no copy) and don't hammer the server after a failure.
_CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache", "scrip_master.json")
_CACHE_MAX_AGE = 24 * 3600
_DOWNLOAD_TIMEOUT = 180
_RETRY_AFTER = 60
_next_attempt = 0.0        # monotonic time before which a failed download isn't retried
_bg_loading = False

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

    with _lock:
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
    with _master_lock:
        _load_master_contract_locked()


def _read_cache(max_age=None):
    """Parsed master list from the disk copy, or None when missing/unreadable/older than max_age."""
    if not _CACHE_PATH or not os.path.exists(_CACHE_PATH):
        return None
    if max_age is not None and time.time() - os.path.getmtime(_CACHE_PATH) > max_age:
        return None
    try:
        with open(_CACHE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _download_resumable(url, attempts=6):
    """Download `url`, resuming with a Range request when the connection drops mid-transfer
    (Angel's server is slow and often cuts the ~36 MB file short)."""
    buf = bytearray()
    total = None
    last = None
    for _ in range(attempts):
        headers = {"User-Agent": "Mozilla/5.0"}
        if buf:
            headers["Range"] = f"bytes={len(buf)}-"
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=_DOWNLOAD_TIMEOUT) as resp:
                status = getattr(resp, "status", 200)
                if buf and status != 206:
                    buf.clear()                       # server ignored the Range header: start over
                if total is None:
                    try:
                        total = int(resp.headers.get("Content-Length")) if resp.headers.get("Content-Length") else None
                    except (AttributeError, TypeError, ValueError):
                        total = None
                while True:
                    chunk = resp.read(1 << 20)
                    if not chunk:
                        break
                    buf.extend(chunk)
            if total is None or len(buf) >= total:
                return bytes(buf)
            last = IOError(f"short download: {len(buf)} of {total} bytes")
        except Exception as e:
            last = e
    raise last or IOError("download failed")


def _fetch_master():
    """Master contract list: fresh disk copy, else download (and cache), else a stale disk copy."""
    data = _read_cache(_CACHE_MAX_AGE)
    if data:
        return data
    try:
        print("Downloading Angel OpenAPIScripMaster.json...")
        raw = _download_resumable(_MASTER_URL)
        data = json.loads(raw.decode("utf-8"))
        if _CACHE_PATH:
            try:
                os.makedirs(os.path.dirname(_CACHE_PATH), exist_ok=True)
                tmp = _CACHE_PATH + ".tmp"
                with open(tmp, "wb") as f:
                    f.write(raw)
                os.replace(tmp, _CACHE_PATH)
            except OSError as e:
                print(f"[WARN] Could not cache the scrip master: {e}")
        return data
    except Exception:
        stale = _read_cache()
        if stale:
            print("[WARN] Scrip master download failed; using the older copy on disk.")
            return stale
        raise


def master_ready() -> bool:
    return _is_loaded


def ensure_master_loading():
    """Start the master download in the background if it isn't loaded or already loading.
    Request paths that can live without the master call this and fall back instead of waiting."""
    global _bg_loading
    if _is_loaded or _bg_loading:
        return

    def work():
        global _bg_loading
        try:
            load_master_contract()
        finally:
            _bg_loading = False

    _bg_loading = True
    threading.Thread(target=work, daemon=True, name="scrip-master").start()


def _load_master_contract_locked():
    global _is_loaded, _master_lookup, _nse_equities, _options_index, _lot_sizes, _next_attempt
    if _is_loaded:  # another thread finished the download while we waited for the lock
        return
    if time.monotonic() < _next_attempt:  # failed recently: don't make every request wait through another attempt
        return
    try:
        data = _fetch_master()

        equities = []
        options = {}
        lot_sizes = {}
        # Build lookup keyed by symbol string (uppercase), only NSE/NFO
        for item in data:
            exch = item.get("exch_seg", "")
            # BSE index derivatives (Sensex, Bankex): only their lot sizes are needed, so don't
            # pull the ~40k BSE contracts into the symbol lookup. NSE/NFO values take priority.
            if exch == "BFO" and item.get("instrumenttype") in ("OPTIDX", "FUTIDX"):
                try:
                    bse_lot = int(float(item.get("lotsize", 0)))
                except (TypeError, ValueError):
                    bse_lot = 0
                if bse_lot > 0:
                    lot_sizes.setdefault(item.get("name", ""), bse_lot)
                continue
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
                if exch == "NFO" and instrument in ("OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"):
                    try:
                        lot = int(float(item.get("lotsize", 0)))
                    except (TypeError, ValueError):
                        lot = 0
                    if lot > 0:
                        lot_sizes[item.get("name", "")] = lot
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
        _lot_sizes = lot_sizes
        _is_loaded = True
        print(f"Angel Scrip Master loaded: {len(_master_lookup)} symbols, {len(_nse_equities)} NSE equities, {len(_options_index)} F&O underlyings.")
    except Exception as e:
        _next_attempt = time.monotonic() + _RETRY_AFTER
        print(f"Failed to load Angel Scrip Master: {e!r} (retrying in {_RETRY_AFTER}s)")


def get_nse_equities():
    """Return the full list of NSE cash-market equities: [{symbol, name}, ...]."""
    load_master_contract()
    return _nse_equities


def _expiry_date(s: str):
    try:
        return datetime.strptime(s, "%d%b%Y")
    except Exception:
        return datetime.max


def search_option_contracts(query: str, limit: int = 40):
    """Search real, unexpired option contracts from the scrip master.

    `query` is free text such as "NIFTY 23100", "banknifty 51000 pe", "reliance 1260 ce sep".
    Words pick the underlying (prefix match), digits pick the strike, CE/PE picks the type,
    and a month name/day like SEP or 29SEP narrows the expiry. A strike is required —
    without one the result set would be thousands of contracts.
    Returns [{symbol, label, underlying, expiry, strike, type}, ...], soonest expiry first."""
    load_master_contract()

    words, strike, opt_type, expiry_hint = [], None, None, None
    for tok in re.split(r"[\s,]+", query.strip().upper()):
        if not tok:
            continue
        if tok.isdigit():
            if strike is None:
                strike = float(tok)
        elif tok in ("CE", "PE"):
            opt_type = tok
        elif re.fullmatch(r"\d{0,2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2,4})?", tok):
            expiry_hint = tok
        else:
            words.append(tok)

    if strike is None:
        return []

    if words:
        # Join so "BANK NIFTY" matches BANKNIFTY; an exact underlying wins over longer prefixes
        # (NIFTY must not drag in NIFTYNXT50).
        name = "".join(words)
        exact = [u for u in _options_index if u == name]
        underlyings = exact or [u for u in _options_index if u.startswith(name)]
    else:
        underlyings = [u for u in _options_index if u in ("NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY")]

    now = datetime.now()
    hits = []
    for u in underlyings:
        for c in _options_index[u]:
            if c["strike"] != strike:
                continue
            if opt_type and c["type"] != opt_type:
                continue
            exp = _expiry_date(c["expiry"])
            if exp.date() < now.date():
                continue
            if expiry_hint and expiry_hint not in c["expiry"]:
                continue
            hits.append((exp, u, c))

    hits.sort(key=lambda h: (h[0], h[1], h[2]["type"]))
    out = []
    for exp, u, c in hits[:limit]:
        e = c["expiry"]  # 27OCT2026 -> "27 OCT 2026"
        strike_txt = f"{c['strike']:g}"
        out.append({
            "symbol": c["symbol"],
            "label": f"{u} {e[:2]} {e[2:5]} {e[5:]} {strike_txt} {c['type']}",
            "underlying": u,
            "expiry": e,
            "strike": c["strike"],
            "type": c["type"],
        })
    return out


def get_lot_sizes():
    """Contract lot size for every F&O underlying, straight from the exchange contract list:
    {"NIFTY": 65, "BANKNIFTY": 30, "RELIANCE": 500, ...}. Lot sizes change over time, so
    nothing in the app should hardcode them."""
    load_master_contract()
    return dict(_lot_sizes)


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

    if not _is_loaded:
        ensure_master_loading()   # symbol mapping needs the master; callers fall back to Yahoo meanwhile
        return None

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

    if not _is_loaded:
        ensure_master_loading()
        return None

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
