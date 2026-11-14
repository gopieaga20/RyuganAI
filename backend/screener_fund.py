"""Fundamental half of the techno-funda screener (blueprint sections 2 and 4), fed by Yahoo Finance through yfinance.

What Yahoo can and cannot give (tested on Reliance, HDFC Bank and Maruti, see ARCHITECTURE.md): statements for net income, EBIT, interest expense, debt, equity, assets,
current liabilities, operating cash flow, EBITDA, revenue and (banks) net interest income, plus ROA, earnings growth and the insiders' holding percentage. It does NOT have
promoter pledge, bank NPA, capital adequacy or NIM: those rules are reported as unavailable and left out of the score (the score is scaled over the points that exist, with a
coverage figure), never guessed.

`fetch_fundamentals()` is the only function that touches the network; everything else is pure so it can be tested with fixtures.
"""
from __future__ import annotations

import datetime as dt
import time
from typing import Callable, Optional

STALE_ANNUAL_DAYS = 16 * 30          # the latest annual statement older than ~16 months: do not score
STALE_QUARTER_DAYS = 200             # a quarterly series older than this is not used (banks often lag)
MIN_COVERAGE = 0.60                  # share of the 50 fundamental points that must be checkable for a stock to enter the feed

# yfinance statement row names (they vary a little by company), first match wins
ROWS = {
    "net_income": ["Net Income", "Net Income Common Stockholders"],
    "ebit": ["EBIT", "Operating Income"],
    "ebitda": ["EBITDA", "Normalized EBITDA"],
    "interest_expense": ["Interest Expense", "Interest Expense Non Operating"],
    "revenue": ["Total Revenue", "Operating Revenue"],
    "nii": ["Net Interest Income"],
    "total_debt": ["Total Debt"],
    "equity": ["Stockholders Equity", "Common Stock Equity", "Total Equity Gross Minority Interest"],
    "total_assets": ["Total Assets"],
    "current_liabilities": ["Current Liabilities", "Total Current Liabilities"],
    "ocf": ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"],
}


# ───────────── the network edge ─────────────
def _series(df, names: list) -> list:
    """[(iso date, value)] newest first from a yfinance statement DataFrame (rows = line items, columns = period end dates)."""
    if df is None or getattr(df, "empty", True):
        return []
    for n in names:
        if n in df.index:
            out = []
            for col, v in df.loc[n].items():
                try:
                    f = float(v)
                except (TypeError, ValueError):
                    continue
                if f != f:
                    continue
                out.append((str(col)[:10], f))
            return sorted(out, key=lambda x: x[0], reverse=True)
    return []


def fetch_fundamentals(symbol: str) -> Optional[dict]:
    """Raw statement lines and a few `info` keys for one NSE symbol ('RELIANCE'), as plain JSON-able data, or None when Yahoo has nothing / refuses (429).
    Never raises: a failure is a missing row, retried next time."""
    try:
        import yfinance as yf
        t = yf.Ticker(f"{symbol}.NS")
        info = {}
        try:
            info = t.info or {}
        except Exception:
            info = {}
        inc, qinc, bs, cf = t.income_stmt, t.quarterly_income_stmt, t.balance_sheet, t.cashflow
        raw = {"symbol": symbol, "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
               "annual": {k: _series(inc, ROWS[k]) for k in ("net_income", "ebit", "ebitda", "interest_expense", "revenue", "nii")},
               "quarterly": {k: _series(qinc, ROWS[k]) for k in ("net_income", "ebitda", "revenue", "nii")},
               "info": {"roe": info.get("returnOnEquity"), "roa": info.get("returnOnAssets"), "earnings_growth": info.get("earningsGrowth"),
                        "revenue_growth": info.get("revenueGrowth"), "insiders": info.get("heldPercentInsiders"), "market_cap": info.get("marketCap"),
                        "sector": info.get("sector"), "industry": info.get("industry")}}
        raw["annual"].update({k: _series(bs, ROWS[k]) for k in ("total_debt", "equity", "total_assets", "current_liabilities")})
        raw["annual"]["ocf"] = _series(cf, ROWS["ocf"])
        have = sum(len(v) for v in raw["annual"].values()) + sum(len(v) for v in raw["quarterly"].values())
        return raw if have else None
    except Exception:
        return None


def refresh_many(symbols: list, fetch: Callable[[str], Optional[dict]], sleep: Callable[[float], None] = time.sleep, gap: float = 2.0,
                 backoff: tuple = (10, 30, 60), on_row: Optional[Callable[[str, Optional[dict]], None]] = None) -> dict:
    """Fetch several symbols politely: `gap` seconds between calls; an empty answer (Yahoo's 429 or no data) is retried after 10, 30, 60 s, then skipped until the next refresh.
    Returns {symbol: raw or None}. `on_row` is called after each symbol (to save as we go)."""
    out: dict = {}
    for k, s in enumerate(symbols):
        if k:
            sleep(gap)
        raw = fetch(s)
        for wait in backoff:
            if raw is not None:
                break
            sleep(wait)
            raw = fetch(s)
        out[s] = raw
        if on_row:
            on_row(s, raw)
    return out


# ───────────── pure computation ─────────────
def _days_old(iso: str, today: dt.date) -> int:
    try:
        return (today - dt.date.fromisoformat(iso[:10])).days
    except ValueError:
        return 10 ** 6


def _first(series: list) -> Optional[float]:
    return series[0][1] if series else None


def _growth(series: list, lag: int, today: dt.date, max_age: int) -> Optional[float]:
    """Percent growth of the newest value over the value `lag` periods earlier; None if there is not enough history, the base is not positive, or the newest period is stale."""
    if len(series) <= lag or _days_old(series[0][0], today) > max_age:
        return None
    a, b = series[0][1], series[lag][1]
    return (a / b - 1) * 100 if b and b > 0 else None


def compute_metrics(raw: dict, today: Optional[dt.date] = None) -> dict:
    """The blueprint's metrics from a raw fundamentals row. Values are None when they cannot be computed or the data is stale.
    Percentages are in percent (15.0 = 15%); debt_equity and interest_coverage are ratios."""
    today = today or dt.date.today()
    a, q, info = raw.get("annual") or {}, raw.get("quarterly") or {}, raw.get("info") or {}
    annual_asof = a.get("net_income", [(None, 0)])[0][0] if a.get("net_income") else None
    stale_annual = annual_asof is None or _days_old(annual_asof, today) > STALE_ANNUAL_DAYS
    m: dict = {"as_of": annual_asof, "stale": bool(stale_annual), "quarter_as_of": (q.get("net_income") or [(None, 0)])[0][0] if q.get("net_income") else None}
    if stale_annual:
        for k in ("profit_growth", "roe", "roce", "debt_equity", "interest_coverage", "ocf_ebitda", "roa", "nii_growth", "ebitda_accelerating"):
            m[k] = None
        m["promoter_pct"] = round(info["insiders"] * 100, 1) if info.get("insiders") is not None else None
        m["pledge_pct"] = None
        return m
    ni, ebit, equity = _first(a.get("net_income", [])), _first(a.get("ebit", [])), _first(a.get("equity", []))
    assets, cl = _first(a.get("total_assets", [])), _first(a.get("current_liabilities", []))
    debt, intexp, ocf, ebitda = _first(a.get("total_debt", [])), _first(a.get("interest_expense", [])), _first(a.get("ocf", [])), _first(a.get("ebitda", []))
    qni = q.get("net_income", [])
    pg = _growth(qni, 4, today, STALE_QUARTER_DAYS)                                    # same quarter a year ago
    pg_src = "quarterly YoY"
    if pg is None:
        pg, pg_src = _growth(a.get("net_income", []), 1, today, STALE_ANNUAL_DAYS), "annual YoY"
    if pg is None and info.get("earnings_growth") is not None:
        pg, pg_src = info["earnings_growth"] * 100, "Yahoo earnings growth"
    qe = q.get("ebitda", [])
    accel = None
    if len(qe) >= 3 and _days_old(qe[0][0], today) <= STALE_QUARTER_DAYS:
        accel = bool(qe[0][1] > qe[1][1] > qe[2][1])
    m.update({
        "profit_growth": round(pg, 1) if pg is not None else None, "profit_growth_source": pg_src if pg is not None else None,
        "ebitda_accelerating": accel,
        "roe": round(ni / equity * 100, 1) if ni is not None and equity and equity > 0 else (round(info["roe"] * 100, 1) if info.get("roe") is not None else None),
        "roce": round(ebit / (assets - cl) * 100, 1) if ebit is not None and assets and cl is not None and assets - cl > 0 else None,
        "debt_equity": round(debt / equity, 2) if debt is not None and equity and equity > 0 else None,
        "interest_coverage": round(ebit / intexp, 1) if ebit is not None and intexp and intexp > 0 else None,
        "ocf_ebitda": round(ocf / ebitda, 2) if ocf is not None and ebitda and ebitda > 0 else None,
        "roa": round(ni / assets * 100, 2) if ni is not None and assets and assets > 0 else (round(info["roa"] * 100, 2) if info.get("roa") is not None else None),
        "nii_growth": None,
        "promoter_pct": round(info["insiders"] * 100, 1) if info.get("insiders") is not None else None,
        "pledge_pct": None,                                                          # Yahoo has no pledge data
    })
    ng = _growth(q.get("nii", []), 4, today, STALE_QUARTER_DAYS)
    if ng is None:
        ng = _growth(a.get("nii", []), 1, today, STALE_ANNUAL_DAYS)
    m["nii_growth"] = round(ng, 1) if ng is not None else None
    return m


# ───────────── gate and score ─────────────
def _part(max_pts: float, ok: Optional[bool], label: str, value=None) -> dict:
    return {"label": label, "max": max_pts, "ok": ok, "earned": (None if ok is None else (max_pts if ok else 0)), "value": value}


def fundamental_score(m: dict, bucket: str) -> dict:
    """Blueprint section 4 (50 points) as parts. Returns {score (scaled to 50), earned, available, coverage (0-1), parts, ok_to_feed}.
    A part whose data does not exist is unavailable (ok None): it is excluded and the rest is scaled up, and coverage says how much of the 50 could be checked."""
    fin = bucket == "FINANCIALS"
    def gt(v, t):
        return None if v is None else v >= t
    def lt(v, t):
        return None if v is None else v < t
    parts = {}
    if not fin:
        g = m.get("profit_growth")
        growth_ok = None if (g is None and m.get("ebitda_accelerating") is None) else bool((g is not None and g >= 15) or m.get("ebitda_accelerating"))
        parts["growth"] = _part(15, growth_ok, "Profit growth >= 15% (or EBITDA rising two quarters)", g)
        parts["roe"] = _part(7.5, gt(m.get("roe"), 15), "ROE >= 15%", m.get("roe"))
        parts["roce"] = _part(7.5, gt(m.get("roce"), 15), "ROCE >= 15%", m.get("roce"))
        parts["debt"] = _part(5, lt(m.get("debt_equity"), 0.5), "Debt/Equity < 0.5", m.get("debt_equity"))
        parts["coverage"] = _part(5, gt(m.get("interest_coverage"), 3), "Interest coverage > 3", m.get("interest_coverage"))
    else:
        parts["growth"] = _part(15, gt(m.get("nii_growth"), 12), "NII growth >= 12%", m.get("nii_growth"))
        parts["roe"] = _part(7.5, gt(m.get("roe"), 14), "ROE > 14%", m.get("roe"))
        parts["roa"] = _part(7.5, gt(m.get("roa"), 1.2), "ROA > 1.2%", m.get("roa"))
        parts["asset_quality"] = _part(10, None, "Net NPA < 0.5% (no data source)", None)
    parts["promoter"] = _part(5, gt(m.get("promoter_pct"), 40), "Promoter holding > 40%", m.get("promoter_pct"))
    parts["pledge"] = _part(5, None if m.get("pledge_pct") is None else m["pledge_pct"] < 5, "Pledge < 5% (no data source)" if m.get("pledge_pct") is None else "Pledge < 5%", m.get("pledge_pct"))
    earned = sum(p["earned"] for p in parts.values() if p["earned"] is not None)
    available = sum(p["max"] for p in parts.values() if p["earned"] is not None)
    total = sum(p["max"] for p in parts.values())
    coverage = available / total if total else 0.0
    return {"score": round(earned / available * 50, 1) if available else 0.0, "earned": earned, "available": available, "coverage": round(coverage, 2),
            "parts": parts, "ok_to_feed": bool(not m.get("stale") and coverage >= MIN_COVERAGE)}


def fundamental_gate(m: dict, bucket: str) -> dict:
    """The hard quality gate of blueprint section 2 on whatever data exists. Returns {pass, failed: [labels], unchecked: [labels]}: a rule with no data is unchecked, not failed;
    stale data or fewer than three checkable rules cannot pass."""
    checks = []
    def add(label, value, ok):
        checks.append((label, value, ok))
    if bucket != "FINANCIALS":
        g = m.get("profit_growth")
        add("Profit growth >= 15% or EBITDA accelerating", g, None if (g is None and m.get("ebitda_accelerating") is None) else bool((g is not None and g >= 15) or m.get("ebitda_accelerating")))
        add("ROE >= 15% and ROCE >= 15%", (m.get("roe"), m.get("roce")), None if m.get("roe") is None or m.get("roce") is None else bool(m["roe"] >= 15 and m["roce"] >= 15))
        add("Debt/Equity < 1 and interest coverage > 3", (m.get("debt_equity"), m.get("interest_coverage")),
            None if m.get("debt_equity") is None else bool(m["debt_equity"] < 1.0 and (m.get("interest_coverage") is None or m["interest_coverage"] > 3)))
        add("Promoter holding > 40%", m.get("promoter_pct"), None if m.get("promoter_pct") is None else m["promoter_pct"] > 40)
        add("Operating cash flow / EBITDA > 0.7", m.get("ocf_ebitda"), None if m.get("ocf_ebitda") is None else m["ocf_ebitda"] > 0.7)
    else:
        add("NII growth >= 12%", m.get("nii_growth"), None if m.get("nii_growth") is None else m["nii_growth"] >= 12)
        add("ROA > 1.2% and ROE > 14%", (m.get("roa"), m.get("roe")), None if m.get("roa") is None or m.get("roe") is None else bool(m["roa"] > 1.2 and m["roe"] > 14))
    known = [c for c in checks if c[2] is not None]
    failed = [c[0] for c in known if not c[2]]
    return {"pass": bool(not m.get("stale") and len(known) >= (3 if bucket != "FINANCIALS" else 2) and not failed), "failed": failed, "unchecked": [c[0] for c in checks if c[2] is None]}
