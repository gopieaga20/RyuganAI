"""
NSE India public-data client.

Only the /api/underlying-information endpoint is used here — it reliably
returns the full universe of F&O underlyings (indices + stocks). NSE's
option-chain endpoints (/api/option-chain-indices, -equities) are blocked by
Akamai bot-protection for non-browser/server-side traffic and are NOT used —
confirmed by direct testing, not assumed.
"""
import httpx

_BASE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}

# Static fallback if NSE is unreachable — the well-known index underlyings.
_FALLBACK_UNDERLYINGS = [
    {"symbol": "NIFTY", "name": "Nifty 50", "type": "INDEX"},
    {"symbol": "BANKNIFTY", "name": "Nifty Bank", "type": "INDEX"},
    {"symbol": "FINNIFTY", "name": "Nifty Financial Services", "type": "INDEX"},
    {"symbol": "MIDCPNIFTY", "name": "Nifty Midcap Select", "type": "INDEX"},
    {"symbol": "SENSEX", "name": "BSE Sensex", "type": "INDEX"},
]


async def get_event_calendar() -> list:
    """NSE's public corporate event calendar (board meetings: financial results, dividends, fund raising...), about the next
    two weeks. Returns [{symbol, purpose, date: 'DD-Mon-YYYY'}], or [] when NSE is unreachable (callers treat that as 'no events')."""
    try:
        async with httpx.AsyncClient(headers=_BASE_HEADERS, timeout=15.0, follow_redirects=True) as client:
            await client.get("https://www.nseindia.com/")
            r = await client.get("https://www.nseindia.com/api/event-calendar?index=equities")
            if r.status_code != 200:
                return []
            data = r.json()
        return [{"symbol": str(x.get("symbol") or "").upper(), "purpose": x.get("purpose") or "", "date": x.get("date") or ""}
                for x in (data if isinstance(data, list) else []) if x.get("symbol")]
    except Exception as e:
        print(f"[WARN] NSE event calendar fetch failed: {e}")
        return []


def events_on(calendar: list, day) -> dict:
    """{symbol: purpose} for events dated `day` (a datetime.date)."""
    import datetime as _dt
    out = {}
    for x in calendar:
        try:
            d = _dt.datetime.strptime(x["date"], "%d-%b-%Y").date()
        except (ValueError, KeyError, TypeError):
            continue
        if d == day:
            out[x["symbol"]] = x["purpose"] or "board meeting"
    return out


async def get_fo_underlyings():
    """Fetch the full list of F&O underlyings (indices + stocks) from NSE.
    Returns [{symbol, name, type}, ...], or the static fallback list on failure."""
    try:
        async with httpx.AsyncClient(headers=_BASE_HEADERS, timeout=15.0, follow_redirects=True) as client:
            await client.get("https://www.nseindia.com/")
            r = await client.get("https://www.nseindia.com/api/underlying-information")
            if r.status_code != 200:
                return _FALLBACK_UNDERLYINGS
            data = r.json().get("data", {})

        out = []
        for item in data.get("IndexList", []):
            sym = item.get("symbol")
            if sym:
                out.append({"symbol": sym, "name": item.get("underlying", sym), "type": "INDEX"})
        for item in data.get("UnderlyingList", []):
            sym = item.get("symbol")
            if sym:
                out.append({"symbol": sym, "name": item.get("underlying", sym), "type": "STOCK"})
        return out or _FALLBACK_UNDERLYINGS
    except Exception as e:
        print(f"[WARN] NSE underlying-information fetch failed: {e}")
        return _FALLBACK_UNDERLYINGS
