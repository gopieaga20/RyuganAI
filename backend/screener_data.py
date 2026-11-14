"""Data ingest for the screener: NSE's free files (bhavcopy with delivery %, ASM/GSM lists, F&O ban list, Nifty-500 industry map) and daily candles.

Every fetcher degrades to "nothing" with a printed warning instead of raising, so a blocked NSE endpoint turns into a "data missing" flag on the run, never a failed run.
Parsers are pure (text in, dict out) and unit-tested against the real file layouts.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
from typing import Optional

import httpx

_UA = {"User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
       "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9", "Referer": "https://www.nseindia.com/"}
ARCHIVES = "https://nsearchives.nseindia.com"


# ───────────── parsers ─────────────
def _num(x) -> Optional[float]:
    try:
        s = str(x).strip().replace(",", "")
        return None if s in ("", "-") else float(s)
    except ValueError:
        return None


def parse_bhavcopy(text: str) -> dict:
    """NSE `sec_bhavdata_full_DDMMYYYY.csv` -> {SYMBOL: {close, volume, turnover, deliv_per}} for the EQ series only. The file is space padded and uses '-' for no value."""
    out: dict = {}
    for row in csv.reader(io.StringIO(text)):
        cells = [c.strip() for c in row]
        if len(cells) < 15 or cells[0].upper() == "SYMBOL":
            continue
        if cells[1].upper() != "EQ":
            continue
        close, vol = _num(cells[8]), _num(cells[10])
        if close is None or vol is None:
            continue
        out[cells[0].upper()] = {"close": close, "volume": int(vol), "turnover": _num(cells[11]),
                                 "deliv_per": _num(cells[14]) if len(cells) > 14 else None}
    return out


def parse_nifty500(text: str) -> dict:
    """`ind_nifty500list.csv` (Company Name, Industry, Symbol, Series, ISIN) -> {SYMBOL: {industry, bucket}}.
    Industry 'Financial Services' is the FINANCIALS bucket (banks, NBFCs, insurance, brokers), everything else CORPORATE."""
    out: dict = {}
    for r in csv.DictReader(io.StringIO(text.lstrip("﻿"))):
        sym = (r.get("Symbol") or "").strip().upper()
        ind = (r.get("Industry") or "").strip()
        if sym:
            out[sym] = {"industry": ind, "bucket": "FINANCIALS" if ind.lower() == "financial services" else "CORPORATE"}
    return out


def parse_ban_list(text: str) -> set:
    """`fo_secban.csv`: a count line then 'n,SYMBOL' rows."""
    out = set()
    for line in text.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 2 and parts[0].isdigit() and parts[1]:
            out.add(parts[1].upper())
    return out


def parse_surveillance(data) -> set:
    """ASM / GSM report JSON -> set of symbols. Accepts the {'data': [...]} / {'longterm': {'data': [...]}, 'shortterm': ...} shapes and a bare list."""
    out: set = set()

    def walk(x):
        if isinstance(x, dict):
            sym = x.get("symbol") or x.get("Symbol")
            if isinstance(sym, str) and sym.strip():
                out.add(sym.strip().upper())
            for v in x.values():
                if isinstance(v, (list, dict)):
                    walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(data)
    return out


# ───────────── candles ─────────────
def ist_date(ts_seconds: int) -> str:
    """Angel's daily candle time is 00:00 IST of the session."""
    return (dt.datetime.fromtimestamp(ts_seconds, dt.timezone.utc) + dt.timedelta(hours=5, minutes=30)).date().isoformat()


def angel_to_rows(candles: list) -> list:
    """get_historical() dicts {t(s), o, h, l, c, v} -> [(iso date, o, h, l, c, v)] dropping rows with a non-positive close and duplicate dates (last wins)."""
    by = {}
    for c in candles or []:
        try:
            if c["c"] > 0 and c["h"] >= c["l"]:
                by[ist_date(int(c["t"]))] = (ist_date(int(c["t"])), float(c["o"]), float(c["h"]), float(c["l"]), float(c["c"]), int(c["v"]))
        except (KeyError, TypeError, ValueError):
            continue
    return [by[d] for d in sorted(by)]


def rows_to_candles(rows: list) -> list:
    """DB rows (iso date or date, o, h, l, c, v, deliv_per) -> screener_tech candles ({ts ms, o, h, l, c, v[, deliv_per]}), ascending."""
    out = []
    for r in rows:
        d = r[0] if isinstance(r[0], dt.date) else dt.date.fromisoformat(str(r[0])[:10])
        ts = int(dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc).timestamp() * 1000)
        c = {"ts": ts, "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "v": int(r[5])}
        if len(r) > 6 and r[6] is not None:
            c["deliv_per"] = float(r[6])
        out.append(c)
    return sorted(out, key=lambda c: c["ts"])


def days_to_fetch(last_date: Optional[str], today: dt.date, backfill: int = 420, overlap: int = 10) -> int:
    """Calendar days of history to request: the full backfill for a new symbol, else the gap since the last stored session plus a small overlap (0 = up to date)."""
    if not last_date:
        return backfill
    gap = (today - dt.date.fromisoformat(last_date)).days
    return 0 if gap <= 0 else min(backfill, gap + overlap)


# ───────────── NSE fetchers (all degrade to empty) ─────────────
def _get(url: str, timeout: float = 20.0, cookies_from: Optional[str] = None) -> Optional[httpx.Response]:
    try:
        with httpx.Client(headers=_UA, timeout=timeout, follow_redirects=True) as c:
            if cookies_from:
                c.get(cookies_from)
            r = c.get(url)
        return r if r.status_code == 200 else None
    except Exception as e:
        print(f"[WARN] screener fetch failed {url}: {e}")
        return None


def fetch_bhavcopy(day: dt.date) -> dict:
    r = _get(f"{ARCHIVES}/products/content/sec_bhavdata_full_{day:%d%m%Y}.csv")
    return parse_bhavcopy(r.text) if r is not None else {}


def latest_bhavcopy(today: dt.date, lookback: int = 7) -> tuple:
    """(date, rows) of the newest session whose file exists (weekends/holidays have none), or (None, {})."""
    for k in range(lookback):
        d = today - dt.timedelta(days=k)
        if d.weekday() >= 5:
            continue
        rows = fetch_bhavcopy(d)
        if rows:
            return d, rows
    return None, {}


def fetch_nifty500() -> dict:
    r = _get(f"{ARCHIVES}/content/indices/ind_nifty500list.csv")
    return parse_nifty500(r.text) if r is not None else {}


def fetch_ban_list(day: dt.date) -> Optional[set]:
    r = _get(f"{ARCHIVES}/archives/fo/sec_ban/fo_secban_{day:%d%m%Y}.csv")
    return parse_ban_list(r.text) if r is not None else None


def fetch_surveillance() -> dict:
    """{'asm': set|None, 'gsm': set|None}: None = could not be fetched (the run flags 'ASM unchecked' instead of assuming clean)."""
    out = {}
    for key, path in (("asm", "reportASM"), ("gsm", "reportGSM")):
        r = _get(f"https://www.nseindia.com/api/{path}", cookies_from="https://www.nseindia.com/")
        try:
            out[key] = parse_surveillance(r.json()) if r is not None else None
        except Exception:
            out[key] = None
    return out
