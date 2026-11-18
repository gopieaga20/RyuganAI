"""Pre-market report sent to Telegram at 08:45 IST on trading days.

Sections: gap estimate from overnight global markets (an estimate: real GIFT Nifty has no free feed), Nifty and Bank Nifty levels (previous day, floor pivots,
India VIX), last night's Screener feed, delivery positions and pending orders, market headlines and today's NSE corporate events.
Numbers only, no AI. Every section is optional: a source that fails shows "n/a" and the report is still sent.
`build_report()` and the helpers are pure; `collect()` does the I/O.
"""
from __future__ import annotations

import asyncio
import datetime as dt
from typing import Callable, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request

import autotrader
import notify

router = APIRouter(prefix="/api/premarket")
SEND_HOUR, SEND_MINUTE = 8, 45
MAX_LEN = 3900                                   # Telegram's limit is 4096 characters
hooks: dict = {"news": None}                     # main.py sets it to get_news (async (q, limit) -> {"headlines": [...]})

# overnight markets used for the gap estimate: (label, Yahoo symbol, weight)
GLOBAL = [("Dow", "^DJI", 1.0), ("S&P 500 fut", "ES=F", 1.5), ("Nikkei", "^N225", 1.0), ("Hang Seng", "^HSI", 1.0)]
CRUDE = ("Crude", "CL=F")


# ───────────── pure helpers ─────────────
def pivots(h: float, l: float, c: float) -> dict:
    """Classic floor pivots from the previous session."""
    p = (h + l + c) / 3
    return {"P": p, "R1": 2 * p - l, "S1": 2 * p - h, "R2": p + (h - l), "S2": p - (h - l)}


def gap_estimate(moves: dict) -> dict:
    """moves {label: % change or None}. Weighted average of the global index moves (crude above +2% counts as a mild negative).
    Returns {label, score, used}. Fewer than two inputs -> 'not enough data'."""
    used = {k: v for k, v in moves.items() if v is not None}
    idx = [(v, w) for (k, _, w) in GLOBAL for kk, v in used.items() if kk == k]
    if len(idx) < 2:
        return {"label": "not enough global data for an estimate", "score": None, "used": used}
    score = sum(v * w for v, w in idx) / sum(w for _, w in idx)
    if used.get(CRUDE[0]) is not None and used[CRUDE[0]] > 2:
        score -= 0.1
    label = "likely gap-up" if score >= 0.4 else "likely gap-down" if score <= -0.4 else "likely flat to small gap"
    return {"label": label, "score": round(score, 2), "used": used}


def seconds_to_next(now_ist: dt.datetime, hour: int = SEND_HOUR, minute: int = SEND_MINUTE) -> float:
    t = now_ist.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if now_ist >= t:
        t += dt.timedelta(days=1)
    while t.weekday() >= 5:
        t += dt.timedelta(days=1)
    return (t - now_ist).total_seconds()


def parse_holidays(data) -> set:
    """NSE holiday-master JSON ({'CM': [{'tradingDate': '26-Jan-2026', ...}], ...}) -> set of dates for the equity segment."""
    out = set()
    rows = (data.get("CM") or []) if isinstance(data, dict) else []
    for r in rows:
        try:
            out.add(dt.datetime.strptime(str(r.get("tradingDate", "")).strip(), "%d-%b-%Y").date())
        except ValueError:
            continue
    return out


def _f(v, d=2):
    return "n/a" if v is None else f"{v:,.{d}f}"


def _pct(v):
    return "n/a" if v is None else f"{v:+.2f}%"


def build_report(d: dict) -> str:
    """Plain-text report from the collected data. Missing pieces print as n/a; never raises on missing keys."""
    today = d.get("date") or dt.date.today()
    L = [f"PRE-MARKET REPORT · {today:%a %d %b %Y}"]
    if d.get("holiday_note"):
        L.append(d["holiday_note"])

    g = d.get("gap") or {}
    L += ["", "OPENING (estimate from global markets, not GIFT Nifty)", f"{(g.get('label') or 'n/a').capitalize()}"]
    used = g.get("used") or {}
    if used:
        L.append(" · ".join(f"{k} {_pct(v)}" for k, v in used.items()))

    L += ["", "LEVELS (previous session)"]
    for name in ("Nifty 50", "Bank Nifty"):
        x = (d.get("levels") or {}).get(name)
        if not x:
            L.append(f"{name}: n/a")
            continue
        p = pivots(x["h"], x["l"], x["c"])
        L.append(f"{name} close {_f(x['c'])} (H {_f(x['h'])} L {_f(x['l'])}, {x.get('date', '')})")
        L.append(f"  S2 {_f(p['S2'], 0)} · S1 {_f(p['S1'], 0)} · P {_f(p['P'], 0)} · R1 {_f(p['R1'], 0)} · R2 {_f(p['R2'], 0)}")
    L.append(f"India VIX {_f(d.get('vix'))}")

    sc = d.get("screener")
    L += ["", "SCREENER (last night)"]
    if not sc:
        L.append("n/a (no run yet)")
    else:
        L.append(f"Run {sc['ran_at']}: {sc['feed']} stock(s) at {sc['min_score']}+")
        for r in sc["top"][:5]:
            s = r.get("setup")
            L.append(f"  {r['symbol']} {r['score']:.0f}" + (f" · {s['type'].lower()} entry {_f(s['entry'])} stop {_f(s['stop'])} T1 {_f(s['t1'])} T2 {_f(s['t2'])} qty {s['qty']}" if s else " · no setup"))

    pos = d.get("positions")
    L += ["", "DELIVERY TRADES"]
    if pos is None:
        L.append("n/a")
    else:
        if not pos["open"] and not pos["orders"]:
            L.append("None open or pending.")
        for p in pos["open"][:8]:
            stage = {"T1_DONE": "half sold", "TRAIL": "trailing"}.get(p.get("stage"), "open")
            L.append(f"  {p['symbol']} {p['qty']} @ {_f(p['entry'])} · stop {_f(p['sl'])} · T1 {_f(p.get('t1'))} T2 {_f(p['tp'])} · {stage}")
        for o in pos["orders"][:8]:
            L.append(f"  pending {'buy-stop' if o['order_type'] == 'SL' else 'limit'} {o['symbol']} {o['qty']} @ {_f(o['price'])} (stop {_f(o['sl'])})")
        if pos.get("other_open"):
            L.append(f"  + {pos['other_open']} other open paper position(s)")

    ev = d.get("events")
    L += ["", "EVENTS TODAY (NSE calendar)"]
    if ev is None:
        L.append("n/a")
    elif not ev:
        L.append("No results or board meetings for F&O stocks.")
    else:
        L.append(", ".join(f"{s} ({p})" for s, p in sorted(ev.items())[:15]))

    if "week52" in d:
        import week52
        L += ["", "52-WEEK HIGH / LOW (F&O stocks)"] + [f"  {x}" for x in week52.telegram_lines(d.get("week52"))]

    news = d.get("news")
    L += ["", "HEADLINES"]
    L += [f"  - {h}" for h in (news or [])[:5]] or ["n/a"]

    L += ["", "Information only, not a recommendation."]
    text = "\n".join(L)
    if len(text) > MAX_LEN:
        text = text[:MAX_LEN - 20].rsplit("\n", 1)[0] + "\n... (trimmed)"
    return text


# ───────────── I/O ─────────────
async def yahoo_change(sym: str) -> Optional[float]:
    """% change of the latest price against the previous close (Yahoo chart API), or None."""
    from urllib.parse import quote
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(sym, safe='^=')}?interval=1d&range=5d"
    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.get(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
        if r.status_code != 200:
            return None
        m = r.json()["chart"]["result"][0]["meta"]
        cur, prev = m.get("regularMarketPrice"), m.get("chartPreviousClose") or m.get("previousClose")
        return round((cur / prev - 1) * 100, 2) if cur and prev else None
    except Exception:
        return None


async def yahoo_price(sym: str) -> Optional[float]:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&range=5d"
    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.get(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
        return float(r.json()["chart"]["result"][0]["meta"]["regularMarketPrice"]) if r.status_code == 200 else None
    except Exception:
        return None


async def fetch_holidays() -> Optional[set]:
    import nse_client
    try:
        async with httpx.AsyncClient(headers=nse_client._BASE_HEADERS, timeout=15.0, follow_redirects=True) as c:
            await c.get("https://www.nseindia.com/")
            r = await c.get("https://www.nseindia.com/api/holiday-master?type=trading")
        return parse_holidays(r.json()) if r.status_code == 200 else None
    except Exception as e:
        print(f"[WARN] NSE holiday list: {e}")
        return None


async def _levels(pool) -> dict:
    out = {}
    try:
        async with pool.acquire() as conn:
            for name, sym in (("Nifty 50", "^NSEI"), ("Bank Nifty", "^NSEBANK")):
                r = await conn.fetchrow("SELECT d, h, l, c FROM daily_candles WHERE symbol = $1 ORDER BY d DESC LIMIT 1", sym)
                if r:
                    out[name] = {"date": r["d"].strftime("%d %b"), "h": float(r["h"]), "l": float(r["l"]), "c": float(r["c"])}
    except Exception as e:
        print(f"[WARN] premarket levels: {e}")
    missing = [n for n in ("Nifty 50", "Bank Nifty") if n not in out]
    if missing:                                   # nothing stored yet: ask Angel for the last few daily candles
        try:
            import angel_broker
            import screener_data
            for name in missing:
                rows = screener_data.angel_to_rows(await asyncio.to_thread(angel_broker.get_historical, "^NSEI" if name == "Nifty 50" else "^NSEBANK", "1d", 10) or [])
                if rows:
                    d, o, h, l, c, v = rows[-1]
                    out[name] = {"date": dt.date.fromisoformat(d).strftime("%d %b"), "h": h, "l": l, "c": c}
        except Exception as e:
            print(f"[WARN] premarket levels fallback: {e}")
    return out


async def _screener(pool) -> Optional[dict]:
    try:
        import screener
        run = await screener.latest_run(pool)
        if not run:
            return None
        s = await screener.get_settings(pool)
        feed = [r for r in run["rows"] if r["feed"]]
        ran = dt.datetime.fromisoformat(run["ran_at"]).astimezone(autotrader.IST)
        return {"ran_at": ran.strftime("%d %b %H:%M"), "feed": len(feed), "min_score": s["min_score"], "top": feed[:5]}
    except Exception as e:
        print(f"[WARN] premarket screener: {e}")
        return None


async def _positions(pool) -> Optional[dict]:
    try:
        async with pool.acquire() as conn:
            pos = await conn.fetch("SELECT symbol, qty, entry_price, sl, tp, t1, stage, source FROM positions ORDER BY entry_time")
            orders = await conn.fetch("SELECT symbol, qty, price, sl, order_type FROM orders WHERE source = 'delivery' ORDER BY id")
        dl = [p for p in pos if p["source"] == "delivery"]
        return {"open": [{"symbol": p["symbol"], "qty": p["qty"], "entry": float(p["entry_price"]), "sl": float(p["sl"]), "tp": float(p["tp"]),
                          "t1": float(p["t1"]) if p["t1"] is not None else None, "stage": p["stage"]} for p in dl],
                "orders": [{"symbol": o["symbol"], "qty": o["qty"], "price": float(o["price"]), "sl": float(o["sl"]), "order_type": o["order_type"]} for o in orders],
                "other_open": len(pos) - len(dl)}
    except Exception as e:
        print(f"[WARN] premarket positions: {e}")
        return None


async def _events(today: dt.date) -> Optional[dict]:
    try:
        from nse_client import get_event_calendar, events_on, get_fo_underlyings
        cal, fo = await asyncio.gather(get_event_calendar(), get_fo_underlyings())
        if not cal:
            return None
        names = {u["symbol"].upper() for u in fo if u.get("type") == "STOCK"}
        ev = events_on(cal, today)
        return {s: p for s, p in ev.items() if not names or s in names}
    except Exception as e:
        print(f"[WARN] premarket events: {e}")
        return None


async def _news() -> Optional[list]:
    fn = hooks.get("news")
    if not fn:
        return None
    try:
        data = await fn("NIFTY", 5)
        return [h.get("title", "").strip() for h in data.get("headlines", []) if h.get("title")]
    except Exception as e:
        print(f"[WARN] premarket news: {e}")
        return None


async def _week52(pool) -> Optional[dict]:
    try:
        import screener
        return await screener.week52_lists(pool)
    except Exception as e:
        print(f"[WARN] premarket 52-week lists: {e}")
        return None


async def collect(pool, today: Optional[dt.date] = None, holiday_note: str = "") -> dict:
    today = today or autotrader.now_ist().date()
    labels = [(k, s) for k, s, _ in GLOBAL] + [CRUDE]
    changes, vix, levels, sc, pos, ev, news, w52 = await asyncio.gather(
        asyncio.gather(*(yahoo_change(s) for _, s in labels)), yahoo_price("^INDIAVIX"), _levels(pool), _screener(pool), _positions(pool), _events(today), _news(), _week52(pool))
    return {"date": today, "holiday_note": holiday_note, "gap": gap_estimate({k: v for (k, _), v in zip(labels, changes)}), "vix": vix,
            "levels": levels, "screener": sc, "positions": pos, "events": ev, "news": news, "week52": w52}


async def should_send(today: dt.date, holidays_fn: Callable = fetch_holidays) -> tuple:
    """(send?, note). Weekend -> no. NSE holiday -> no. Holiday list unavailable -> yes, with a note."""
    if today.weekday() >= 5:
        return False, ""
    hol = await holidays_fn()
    if hol is None:
        return True, "(NSE holiday list unavailable: sent anyway)"
    return (today not in hol), ""


async def premarket_loop(pool) -> None:
    while True:
        try:
            await asyncio.sleep(seconds_to_next(autotrader.now_ist()))
            today = autotrader.now_ist().date()
            ok, note = await should_send(today)
            if ok:
                text = build_report(await collect(pool, today, note))
                await notify.notify(pool, "premarket", text, key=f"premarket:{today.isoformat()}")
            await asyncio.sleep(120)                        # past 08:45 before computing the next wait
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[WARN] premarket loop: {e}")
            await asyncio.sleep(600)


# ───────────── endpoints ─────────────
@router.get("/preview")
async def preview(request: Request):
    """The report as it would be sent now. Sends nothing."""
    return {"text": build_report(await collect(request.app.state.pool))}


@router.post("/send")
async def send_now(request: Request):
    """Build and send now (respects the Telegram on/off switches, not the 08:45 time)."""
    pool = request.app.state.pool
    text = build_report(await collect(pool))
    if not notify.configured():
        raise HTTPException(status_code=400, detail="Telegram is not set up on the server (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).")
    queued = await notify.notify(pool, "premarket", text)
    if not queued:
        raise HTTPException(status_code=400, detail="Not sent: switch on Telegram alerts and the Pre-market report in the alert settings, and save.")
    return {"sent": True, "text": text}
