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
_session_at = 0.0          # when the current session was created
_last_ok_at = 0.0          # last successful Angel call
_last_error = ""          # last Angel error text, for /api/health
_loaded_at = 0.0           # when the scrip master was last (re)loaded
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
_MASTER_REFRESH_AGE = 8 * 3600          # reload the contract list when it is older than this (new expiries, new tokens)
_MASTER_REFRESH_CACHE_AGE = 6 * 3600    # ...and don't trust a disk copy older than this when doing so
_bg_loading = False

# ── Session management ────────────────────────────────────────────────────────

def _get_credentials():
    api_key    = os.getenv("ANGEL_API_KEY", "").strip().strip('"')
    client_code= os.getenv("ANGEL_CLIENT_CODE", "").strip().strip('"')
    password   = os.getenv("ANGEL_PASSWORD", "").strip().strip('"')
    totp_secret= os.getenv("ANGEL_TOTP_SECRET", "").strip().strip('"')
    return api_key, client_code, password, totp_secret

# Angel's login token stops working after about a day. It used to be kept until the process restarted, and only the exact
# words "Session Expired" triggered a new login, but Angel answers "Invalid Token", so every Angel call failed from the
# next morning until the server was restarted. Now the session is renewed on a schedule and on any auth-looking error.
_SESSION_MAX_AGE = 5 * 3600


def get_angel_client(force: bool = False):
    """Return an authenticated SmartConnect object, logging in again when there is none, it is older than
    _SESSION_MAX_AGE, or `force` is set."""
    global _angel_obj, _auth_token, _feed_token, _session_at, _last_error

    api_key, client_code, password, totp_secret = _get_credentials()
    if not all([api_key, client_code, password, totp_secret]):
        return None

    with _lock:
        fresh = _angel_obj and _auth_token and (time.time() - _session_at) < _SESSION_MAX_AGE
        if fresh and not force:
            return _angel_obj
        old = _angel_obj if (_angel_obj and _auth_token and not force) else None

        try:
            from SmartApi import SmartConnect # type: ignore
            obj = SmartConnect(api_key=api_key)
            totp = pyotp.TOTP(totp_secret).now()
            data = obj.generateSession(client_code, password, totp)
            if not data or not data.get("status"):
                _last_error = f"login failed: {data}"
                print("Angel SmartAPI login failed:", data)
                return old                      # a scheduled refresh that fails keeps the old session, which may still work
            _angel_obj  = obj
            _auth_token = data["data"]["jwtToken"]
            _feed_token = data["data"].get("feedToken", "")
            _session_at = time.time()
            print("Angel SmartAPI: logged in successfully.")
            return _angel_obj
        except Exception as e:
            _last_error = f"login error: {e}"
            print("Angel SmartAPI init error:", e)
            return old


def _is_session_error(x) -> bool:
    t = str(x).lower()
    return any(k in t for k in ("invalid token", "session", "expired", "ag8001", "ag8002", "ag8003", "unauthor", "jwt"))


def call_angel(method: str, **kwargs):
    """Call a SmartConnect method; if Angel says the session is bad, log in again and retry once.
    Returns the response, or None when there is no session. Other errors propagate."""
    global _last_ok_at, _last_error
    for attempt in (1, 2):
        client = get_angel_client()
        if not client:
            return None
        try:
            res = getattr(client, method)(**kwargs)
        except Exception as e:
            if attempt == 1 and _is_session_error(e):
                invalidate_session()
                continue
            _last_error = f"{method}: {e}"
            raise
        if isinstance(res, dict) and not res.get("status") and attempt == 1 and _is_session_error(res):
            invalidate_session()
            continue
        if isinstance(res, dict) and res.get("status"):
            _last_ok_at = time.time()
        elif isinstance(res, dict):
            _last_error = f"{method}: {res.get('message') or res}"
        return res
    return None


def session_info() -> dict:
    now = time.time()
    return {
        "logged_in": bool(_angel_obj and _auth_token),
        "session_age_s": round(now - _session_at) if _session_at else None,
        "last_ok_s_ago": round(now - _last_ok_at) if _last_ok_at else None,
        "last_error": _last_error or None,
        "master_loaded": _is_loaded,
        "master_age_s": round(now - _loaded_at) if _loaded_at else None,
    }


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


def _fetch_master(max_cache_age=None):
    """Master contract list: fresh disk copy, else download (and cache), else a stale disk copy."""
    data = _read_cache(_CACHE_MAX_AGE if max_cache_age is None else max_cache_age)
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


def refresh_master_if_stale():
    """The contract list changes every day (new weekly expiries, new tokens), but it used to be loaded once per process,
    so a server left running for days stopped finding new option contracts. Reload it when it is old."""
    global _bg_loading
    if not _is_loaded or _bg_loading or (time.time() - _loaded_at) < _MASTER_REFRESH_AGE:
        return False

    def work():
        global _bg_loading
        try:
            with _master_lock:
                _load_master_contract_locked(force=True)
        finally:
            _bg_loading = False

    _bg_loading = True
    threading.Thread(target=work, daemon=True, name="scrip-master-refresh").start()
    return True


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


def _load_master_contract_locked(force: bool = False):
    global _is_loaded, _master_lookup, _nse_equities, _options_index, _lot_sizes, _next_attempt, _loaded_at
    if _is_loaded and not force:  # another thread finished the download while we waited for the lock
        return
    if time.monotonic() < _next_attempt:  # failed recently: don't make every request wait through another attempt
        return
    try:
        data = _fetch_master(_MASTER_REFRESH_CACHE_AGE if force else None)
        lookup = {}                      # built on the side and swapped in at the end, so readers never see a half-built table

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
                lookup[sym] = {
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
        _master_lookup = lookup
        _is_loaded = True
        _loaded_at = time.time()
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
        res = call_angel("ltpData", exchange=info["exch"], tradingsymbol=mapped_sym, symboltoken=info["token"])
        if not (res and res.get("status") and res.get("data")):
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

# Angel caps how many days one getCandleData call may span, per candle size (conservative values), and
# rate-limits callers, so long histories are fetched in windows, spaced out, and retried when throttled.
# Index tokens from Angel's scrip master (instrumenttype AMXIDX), which the NSE/NFO lookup does not keep.
_INDEX_TOKENS = {
    "NIFTY": ("NSE", "99926000"), "BANKNIFTY": ("NSE", "99926009"),
    "INDIA VIX": ("NSE", "99926017"), "SENSEX": ("BSE", "99919000"),
}
_CHUNK_DAYS = {
    "ONE_MINUTE": 25, "FIVE_MINUTE": 90, "FIFTEEN_MINUTE": 180, "THIRTY_MINUTE": 180,
    "ONE_HOUR": 360, "ONE_DAY": 1800, "ONE_WEEK": 1800,
}
_CALL_GAP_S = 3.0          # pause between calls (Angel throttles hard, even at ~1 call per second)
_THROTTLE_WAIT_S = 10.0    # wait after an "exceeding access rate" reply (grows with each retry)
_THROTTLE_RETRIES = 4


def _parse_candle_rows(rows):
    out = []
    for row in rows or []:
        # Angel returns: [timestamp_str, open, high, low, close, volume]
        try:
            ts = int(datetime.fromisoformat(str(row[0])).timestamp())
            out.append({"t": ts, "o": float(row[1]), "h": float(row[2]), "l": float(row[3]), "c": float(row[4]), "v": int(row[5])})
        except Exception:
            continue
    return out


def _fetch_window(client, info, angel_interval, start, end):
    """One getCandleData call with retries on throttling. Returns (candles | None, fatal_error_text | None)."""
    params = {"exchange": info["exch"], "symboltoken": info["token"], "interval": angel_interval,
              "fromdate": start.strftime("%Y-%m-%d %H:%M"), "todate": end.strftime("%Y-%m-%d %H:%M")}
    last = None
    for attempt in range(_THROTTLE_RETRIES + 1):
        try:
            res = call_angel("getCandleData", historicDataParams=params)
        except Exception as e:
            last = str(e)
            if "access rate" in last.lower() or "exceeding" in last.lower():
                time.sleep(_THROTTLE_WAIT_S * (attempt + 1))
                continue
            return None, last
        if res and res.get("status"):
            return _parse_candle_rows(res.get("data")), None
        last = str(res)
        if "Session" in last:
            invalidate_session()
            return None, last
        if "access rate" in last.lower() or "exceeding" in last.lower():
            time.sleep(_THROTTLE_WAIT_S * (attempt + 1))
            continue
        return [], last            # e.g. "no data" for this window: treat as empty, keep going
    return None, last


def get_historical(symbol: str, interval: str = "15m", days: int = 90):
    """
    Fetch historical OHLCV candlestick data from Angel One getCandleData API, in as many windows as needed.
    Returns list of dicts: [{t, o, h, l, c, v}, …] sorted ascending by time, de-duplicated.
    If a later window fails (for example the rate limit keeps refusing), what was fetched so far is returned.
    Returns None when nothing could be fetched — caller should fall back to Yahoo Finance.

    Args:
        symbol:   Frontend symbol string, e.g. "^NSEI", "RELIANCE.NS", "NIFTY 24 MAR 23100 CE"
        interval: Candle interval — "1m","5m","15m","30m","1h","1d","1wk"
        days:     Number of calendar days of history to fetch
    """
    client = get_angel_client()
    if not client:
        return None

    if not _is_loaded:
        ensure_master_loading()
        return None

    idx = _INDEX_TOKENS.get(_map_symbol(symbol))            # index candles: the NSE/NFO lookup has no (or the wrong) entry
    if idx:
        info = {"exch": idx[0], "token": idx[1]}
    else:
        mapped_sym, info = _lookup_with_fuzzy(symbol)
    if not info:
        return None

    angel_interval = _ANGEL_INTERVAL_MAP.get(interval)
    if not angel_interval:
        print(f"Unsupported interval for Angel One: {interval}")
        return None

    step = timedelta(days=_CHUNK_DAYS.get(angel_interval, 90))
    end = datetime.now()
    start_all = end - timedelta(days=days)
    by_ts = {}
    first_call = True
    cursor_end = end
    while cursor_end > start_all:
        cursor_start = max(start_all, cursor_end - step)
        if not first_call:
            time.sleep(_CALL_GAP_S)
        first_call = False
        candles, err = _fetch_window(client, info, angel_interval, cursor_start, cursor_end)
        if candles is None:
            print(f"Angel get_historical '{symbol}' stopped at {cursor_start:%Y-%m-%d}: {err}")
            break
        for c in candles:
            by_ts[c["t"]] = c
        cursor_end = cursor_start - timedelta(minutes=1)
    out = [by_ts[t] for t in sorted(by_ts)]
    return out if out else None
