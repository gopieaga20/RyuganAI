"""52-week high / low lists for NSE F&O stocks, on daily closes.

Four lists, distances in RUPEES (the owner's choice; the same rupee gap is tight for a Rs 30,000 stock and wide for a Rs 100 one):
  high breakout  : the last close is above the previous 52-week high by up to `break_pts`
  near high      : the last close is at or below the previous 52-week high by up to `near_pts`
  low breakdown  : the last close is below the previous 52-week low by up to `break_pts`
  near low       : the last close is at or above the previous 52-week low by up to `near_pts`
"Previous" = the 251 sessions before the last one (so a fresh break can be seen); the last candle itself is the one being tested.
Pure: candles in, lists out. The data come from the screener's `daily_candles` table (refreshed nightly).
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

YEAR = 252
MIN_BARS = 200          # a stock listed for less than about 10 months has no real 52-week range


def _day(ts_ms: int) -> str:
    return dt.datetime.fromtimestamp(ts_ms / 1000, dt.timezone.utc).date().isoformat()


def classify(candles: list, break_pts: float = 20.0, near_pts: float = 30.0) -> Optional[dict]:
    """One stock: {close, date, high52, high_date, low52, low_date, kind: 'high_break'|'near_high'|'low_break'|'near_low'|None, gap} or None without enough data.
    `gap` is close minus the level (positive above it)."""
    if len(candles) < MIN_BARS + 1:
        return None
    last, prev = candles[-1], candles[-YEAR:-1] if len(candles) > YEAR else candles[:-1]
    hi = max(prev, key=lambda c: c["h"])
    lo = min(prev, key=lambda c: c["l"])
    close, h52, l52 = last["c"], hi["h"], lo["l"]
    up, down = close - h52, close - l52
    kind = None
    if 0 < up <= break_pts:
        kind = "high_break"
    elif -near_pts <= up <= 0:
        kind = "near_high"
    elif -break_pts <= down < 0:
        kind = "low_break"
    elif 0 <= down <= near_pts:
        kind = "near_low"
    vols = [c.get("v") or 0 for c in candles[-21:-1]]
    avg_v = sum(vols) / len(vols) if vols else 0
    return {"close": round(close, 2), "date": _day(last["ts"]), "high52": round(h52, 2), "high_date": _day(hi["ts"]), "low52": round(l52, 2),
            "low_date": _day(lo["ts"]), "kind": kind, "gap": round(up if kind in ("high_break", "near_high") else down, 2),
            "gap_pct": round((up / h52 if kind in ("high_break", "near_high") else down / l52) * 100, 2) if kind else None,
            "vol_ratio": round((last.get("v") or 0) / avg_v, 2) if avg_v > 0 else None}


def lists(candle_map: dict, break_pts: float = 20.0, near_pts: float = 30.0) -> dict:
    """{symbol: candles} -> {high_break, near_high, low_break, near_low: [rows sorted nearest first], checked, asof}."""
    out = {"high_break": [], "near_high": [], "low_break": [], "near_low": []}
    checked, dates = 0, []
    for sym, cs in candle_map.items():
        r = classify(cs, break_pts, near_pts)
        if not r:
            continue
        checked += 1
        dates.append(r["date"])
        if r["kind"]:
            out[r["kind"]].append({"symbol": sym, **r})
    out["high_break"].sort(key=lambda r: r["gap"])            # smallest break first (freshest)
    out["near_high"].sort(key=lambda r: -r["gap"])            # closest to the high first
    out["low_break"].sort(key=lambda r: -r["gap"])
    out["near_low"].sort(key=lambda r: r["gap"])
    out["checked"] = checked
    out["asof"] = max(dates) if dates else None
    out["break_pts"], out["near_pts"] = break_pts, near_pts
    return out


def evening_text(w: dict, limit: int = 15) -> str:
    """The evening Telegram message after the nightly run."""
    return "\n".join([f"52-WEEK HIGH / LOW (F&O stocks)"] + telegram_lines(w, limit) +
                      ["Daily closes. Information only, not a recommendation."])


def telegram_lines(w: Optional[dict], limit: int = 10) -> list:
    """Short text lines for the pre-market report."""
    if not w or not w.get("checked"):
        return ["n/a (no daily candles yet: they are stored by the nightly Screener run)"]
    names = {"high_break": f"Above 52w high (by up to Rs {w['break_pts']:g})", "near_high": f"Within Rs {w['near_pts']:g} below 52w high",
             "low_break": f"Below 52w low (by up to Rs {w['break_pts']:g})", "near_low": f"Within Rs {w['near_pts']:g} above 52w low"}
    lines = [f"Closes of {w['asof']}, {w['checked']} F&O stocks checked"]
    for k, label in names.items():
        rows = w[k]
        txt = ", ".join(f"{r['symbol']} {r['close']:,.2f} ({r['gap']:+.1f})" for r in rows[:limit]) or "none"
        lines.append(f"{label}: {txt}" + (f" +{len(rows) - limit} more" if len(rows) > limit else ""))
    return lines
