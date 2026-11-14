"""Backtest of the TECHNICAL gate of the techno-funda screener (blueprint sections 3-5) on daily data.

    python tools/bt_screener.py            # uses tools/.cache/ANGEL_<SYM>_1d_1500d.json (node tools/pull_angel.mjs 1500 1d) and writes reports/screener_technical_gate_backtest.md

What it does: walks every F&O stock day by day, applies the same functions the live screener uses (backend/screener_tech.py): trend stack + RS rating > 80 + within 15% of the
52-week high, then the breakout or pullback setup; the order is placed at the close, filled the next session if price reaches it, and the trade is managed with the same
`advance()` lifecycle (stop, sell half at T1 and move the stop to the entry, trail the rest under the 20-EMA, T2). At most 10 positions at once, one per stock.

What it cannot do: fundamentals and exchange delivery % have no point-in-time history, so they are NOT in this test. The universe is today's F&O list (survivorship bias).
Costs: 0.25% of the position per round trip (brokerage, STT on both sides, slippage).
"""
from __future__ import annotations

import glob
import json
import math
import os
import random
import statistics
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
import screener_tech as st  # noqa: E402

CACHE = os.path.join(ROOT, "tools", ".cache")
MAX_POS = 10
MAX_DAYS = 60
COST_PCT = 0.0025
UNITS = 1000
DAY_MS = 86400000


def day_of(ts: int) -> int:
    return int((ts + 19800000) // DAY_MS)


def load() -> tuple:
    bench = None
    syms: dict = {}
    notes = Counter()
    for f in sorted(glob.glob(os.path.join(CACHE, "ANGEL_*_1d_1500d.json"))):
        name = os.path.basename(f)[len("ANGEL_"):-len("_1d_1500d.json")]
        rows = json.load(open(f, encoding="utf-8"))
        rows = [r for r in rows if r.get("c") and r["c"] > 0]
        if name == "_NSEI":
            bench = rows
            continue
        if name in ("_NSEBANK", "_BSESN") or len(rows) < st.MIN_BARS + 60:
            notes["too short / index"] += 1
            continue
        cut = 0                                              # a split or bonus shows up as a jump: keep only the bars after the last one
        for i in range(1, len(rows)):
            r = rows[i]["c"] / rows[i - 1]["c"]
            if r < 0.6 or r > 1.7:
                cut = i
        if cut:
            notes["series cut after a corporate-action jump"] += 1
            rows = rows[cut:]
        if len(rows) < st.MIN_BARS + 60:
            notes["too short after the cut"] += 1
            continue
        syms[name] = rows
    return bench, syms, notes


def build(bench_rows: list, syms: dict) -> dict:
    bench_by_day = {day_of(r["ts"]): r["c"] for r in bench_rows}
    days_sorted = sorted(bench_by_day)
    data = {}
    for name, rows in syms.items():
        ind = st.indicators(rows)
        closes = [r["c"] for r in rows]
        last_b, bench_aligned = None, []
        for r in rows:
            b = bench_by_day.get(day_of(r["ts"]), last_b)
            last_b = b if b else last_b
            bench_aligned.append(last_b or 0)
        rel = [st.relative_performance(closes, bench_aligned, i) if i >= 126 else None for i in range(len(rows))]
        data[name] = {"rows": rows, "ind": ind, "rel": rel, "idx": {day_of(r["ts"]): i for i, r in enumerate(rows)}}
    return {"data": data, "days": days_sorted, "bench": bench_by_day}


def run(world: dict) -> tuple:
    data, days = world["data"], world["days"]
    open_pos: dict = {}
    pending: list = []
    trades: list = []
    first_day = days[st.MIN_BARS + 20]
    sim_days = [d for d in days if d >= first_day]
    for D in sim_days:
        # 1. manage the open trades
        for sym in list(open_pos):
            p = open_pos[sym]
            i = data[sym]["idx"].get(D)
            if i is None:
                continue
            bar = data[sym]["rows"][i]
            exits = st.advance(p["tr"], bar["o"], bar["h"], bar["l"], bar["c"], data[sym]["ind"]["ema20"][i])
            p["exits"] += exits
            if p["tr"]["stage"] != "CLOSED" and p["tr"]["days"] >= MAX_DAYS:
                q = p["tr"]["qty_open"]
                p["exits"].append((bar["c"], q, "TIME"))
                p["tr"]["realised"] += (bar["c"] - p["tr"]["entry"]) * q
                p["tr"]["stage"], p["tr"]["qty_open"] = "CLOSED", 0
            if p["tr"]["stage"] == "CLOSED":
                trades.append(finish(sym, p, D))
                del open_pos[sym]
        # 2. fill what was ordered yesterday
        todays, pending = pending, []
        for o in todays:
            sym = o["sym"]
            i = data[sym]["idx"].get(D)
            if i is None or sym in open_pos or len(open_pos) >= MAX_POS:
                continue
            bar = data[sym]["rows"][i]
            fill = None
            if o["trigger"] == "buy-stop":
                fill = bar["o"] if bar["o"] >= o["entry"] else (o["entry"] if bar["h"] >= o["entry"] else None)
            elif o["trigger"] == "limit":
                fill = min(bar["o"], o["entry"]) if bar["l"] <= o["entry"] else None
            elif o["trigger"] == "market":
                fill = bar["o"]
            if fill is None or fill <= o["stop"]:
                continue
            tr = st.new_trade(fill, UNITS, o["stop"], o["t1"], o["t2"])
            p = {"tr": tr, "exits": [], "setup": o["type"], "signal_day": o["signal_day"], "entry_day": D, "stop0": o["stop"], "rs": o["rs"], "entry": fill}
            exits = st.advance(tr, fill, bar["h"], bar["l"], bar["c"], data[sym]["ind"]["ema20"][i])
            p["exits"] += exits
            if tr["stage"] == "CLOSED":
                trades.append(finish(sym, p, D))
            else:
                open_pos[sym] = p
        # 3. this evening's signals
        ratings = st.rs_ratings({s: (data[s]["rel"][data[s]["idx"][D]] if D in data[s]["idx"] else None) for s in data})
        cands = []
        for s, dd in data.items():
            i = dd["idx"].get(D)
            if i is None or i < st.MIN_BARS or s in open_pos or any(x["sym"] == s for x in pending):
                continue
            rs = ratings.get(s)
            gate = st.technical_gate(dd["rows"], dd["ind"], i, rs)
            if not gate["pass"]:
                continue
            setup = st.breakout_setup(dd["rows"], dd["ind"], i) or st.pullback_setup(dd["rows"], dd["ind"], i)
            if setup:
                cands.append((rs, s, setup))
        cands.sort(key=lambda x: -x[0])
        room = MAX_POS - len(open_pos) - len(pending)
        for rs, s, setup in cands[:max(room, 0)]:
            pending.append({"sym": s, "signal_day": D, "rs": rs, **setup})
    return trades, len(sim_days), sim_days[0], sim_days[-1]


def finish(sym: str, p: dict, day: int) -> dict:
    tr = p["tr"]
    risk = p["entry"] - p["stop0"]
    r_gross = tr["realised"] / UNITS / risk if risk > 0 else 0.0
    cost_r = COST_PCT * p["entry"] / risk if risk > 0 else 0.0
    return {"sym": sym, "setup": p["setup"], "signal_day": p["signal_day"], "entry_day": p["entry_day"], "exit_day": day, "entry": p["entry"], "stop": p["stop0"],
            "r_gross": r_gross, "r": r_gross - cost_r, "days": tr["days"], "exit": p["exits"][-1][2] if p["exits"] else "?", "rs": p.get("rs")}


# ───────────── controls ─────────────
def control(world: dict, n_trades: int, gate_only: bool, seed: int) -> list:
    """Random entries managed exactly like the real trades (market order at the next open, stop 1.5 ATR, T1 2R, T2 3R). gate_only: only on days the technical gate passes."""
    rnd = random.Random(seed)
    data, days = world["data"], world["days"]
    names = list(data)
    out, tries = [], 0
    ratings_cache: dict = {}
    while len(out) < n_trades and tries < n_trades * 60:
        tries += 1
        s = rnd.choice(names)
        dd = data[s]
        i = rnd.randrange(st.MIN_BARS, len(dd["rows"]) - MAX_DAYS - 2)
        D = day_of(dd["rows"][i]["ts"])
        if gate_only:
            if D not in ratings_cache:
                ratings_cache[D] = st.rs_ratings({x: (data[x]["rel"][data[x]["idx"][D]] if D in data[x]["idx"] else None) for x in data})
            if not st.technical_gate(dd["rows"], dd["ind"], i, ratings_cache[D].get(s))["pass"]:
                continue
        a = dd["ind"]["atr"][i]
        nxt = dd["rows"][i + 1]
        entry = nxt["o"]
        stop = entry - 1.5 * a
        if not (a > 0 and entry > stop > 0):
            continue
        risk = entry - stop
        tr = st.new_trade(entry, UNITS, stop, entry + 2 * risk, entry + 3 * risk)
        exits = []
        for k in range(i + 1, min(len(dd["rows"]), i + 1 + MAX_DAYS)):
            b = dd["rows"][k]
            exits += st.advance(tr, b["o"] if k > i + 1 else entry, b["h"], b["l"], b["c"], dd["ind"]["ema20"][k])
            if tr["stage"] == "CLOSED":
                break
        if tr["stage"] != "CLOSED":
            b = dd["rows"][min(len(dd["rows"]) - 1, i + MAX_DAYS)]
            tr["realised"] += (b["c"] - entry) * tr["qty_open"]
        out.append(tr["realised"] / UNITS / risk - COST_PCT * entry / risk)
    return out


# ───────────── statistics ─────────────
def stats(rs: list) -> dict:
    n = len(rs)
    if not n:
        return {"n": 0, "avg": 0.0, "med": 0.0, "win": 0.0, "pf": 0.0, "total": 0.0}
    wins = [x for x in rs if x > 0]
    loss = -sum(x for x in rs if x <= 0)
    return {"n": n, "avg": sum(rs) / n, "med": statistics.median(rs), "win": 100 * len(wins) / n, "pf": (sum(wins) / loss) if loss else 9.99, "total": sum(rs)}


def fmt(s: dict) -> str:
    return f"{s['n']} | {s['avg']:+.2f} | {s['med']:+.2f} | {s['win']:.0f}% | {s['pf']:.2f} | {s['total']:+.0f}"


def boot_p(real_avg: float, ctrl: list, n: int, trials: int = 3000) -> float:
    rnd = random.Random(7)
    hits = 0
    for _ in range(trials):
        if sum(rnd.choice(ctrl) for _ in range(n)) / n >= real_avg:
            hits += 1
    return hits / trials


def main() -> None:
    bench_rows, syms, notes = load()
    if not bench_rows or not syms:
        sys.exit("no daily data in tools/.cache: run  node tools/pull_angel.mjs 1500 1d  (with SYMS=...) first")
    world = build(bench_rows, syms)
    trades, n_days, d0, d1 = run(world)
    trades.sort(key=lambda t: t["exit_day"])
    ymd = lambda d: __import__("datetime").date.fromordinal(d + 719163).isoformat()      # days since 1970-01-01 -> date
    rs = [t["r"] for t in trades]
    all_s = stats(rs)
    mid_day = d0 + (d1 - d0) // 2
    first = [t["r"] for t in trades if t["entry_day"] <= mid_day]
    second = [t["r"] for t in trades if t["entry_day"] > mid_day]
    by_year = defaultdict(list)
    for t in trades:
        by_year[ymd(t["entry_day"])[:4]].append(t["r"])
    by_setup = defaultdict(list)
    for t in trades:
        by_setup[t["setup"]].append(t["r"])
    by_sym = defaultdict(float)
    for t in trades:
        by_sym[t["sym"]] += t["r"]
    exits = Counter(t["exit"] for t in trades)
    ctrl_all = control(world, max(len(trades), 1500), False, 1)
    ctrl_gate = control(world, max(len(trades), 1500), True, 2)
    cs, cg = stats(ctrl_all), stats(ctrl_gate)
    p_all = boot_p(all_s["avg"], ctrl_all, max(all_s["n"], 1))
    p_gate = boot_p(all_s["avg"], ctrl_gate, max(all_s["n"], 1))
    cum, peak, dd, curve = 0.0, 0.0, 0.0, []
    for t in trades:
        cum += t["r"]
        peak = max(peak, cum)
        dd = min(dd, cum - peak)
    bench_ret = world["bench"][days_last(world)] / world["bench"][d0 if d0 in world["bench"] else min(world["bench"], key=lambda x: abs(x - d0))] - 1
    top = sorted(by_sym.items(), key=lambda kv: -kv[1])
    pos_total = sum(v for _, v in top if v > 0)

    L = []
    L.append("# Technical gate of the techno-funda screener: 4-year backtest\n")
    L.append(f"Generated by `python tools/bt_screener.py`. **{len(syms)} F&O stocks**, daily candles {ymd(d0)} to {ymd(d1)} ({n_days} trading days after a 250-bar warm-up), benchmark Nifty 50. "
             f"Rules are the ones the live screener uses (`backend/screener_tech.py`): close > 50-EMA > 200-EMA with a rising 200-EMA, RS rating > 80 (percentile of 3- and 6-month performance relative to Nifty 50 across the stocks), "
             f"within 15% of the 52-week high; then a **breakout** (close above the 20-day high out of a base no wider than 15%, volume >= 1.5x the 20-day average, RSI <= 78, not more than 1 ATR above the entry) "
             f"or a **pullback** (bullish reversal candle in the 20/50-EMA zone, RSI 45-60, T1 at least 1:2). Entry, stop, T1 (2R, or the swing high for pullbacks) and T2 (3R) follow blueprint section 5. "
             f"The order is placed at the close and filled the next session only if price reaches it. Management: stop = whole position; T1 sells half and moves the stop to the entry; the rest trails under the 20-EMA or exits at T2; "
             f"force-exit after {MAX_DAYS} sessions. At most {MAX_POS} positions at once, one per stock, strongest RS first. Costs {COST_PCT * 100:.2f}% of the position per round trip. R = profit divided by the initial risk.\n")
    L.append("**What this does NOT test:** the fundamental gate and exchange delivery % (no point-in-time history exists), and the universe is today's F&O list, so stocks that were dropped or collapsed are missing (survivorship bias flatters long-only results). "
             f"Data notes: {dict(notes)}.\n")
    L.append("## Result\n")
    L.append("| | Trades | Avg R (net) | Median R | Win rate | Profit factor | Total R |\n|---|---|---|---|---|---|---|")
    L.append(f"| **Screener technical gate** | {fmt(all_s)} |")
    L.append(f"| Random entries, same stop / target management (control) | {fmt(cs)} |")
    L.append(f"| Entries only on days the gate passes, no setup rule (control) | {fmt(cg)} |\n")
    L.append(f"- p-value of the average R against random entries: **{p_all:.3f}**; against gate-passing days: **{p_gate:.3f}** (share of random samples of the same size that did at least as well).")
    L.append(f"- At 1% risk per trade the sum of R is roughly {all_s['total']:.0f}% of equity before compounding; worst peak-to-trough in cumulative R: {dd:.1f} R. Nifty 50 buy-and-hold over the same days: {bench_ret * 100:+.0f}%.")
    L.append(f"- Average holding {statistics.mean([t['days'] for t in trades]):.0f} sessions; exits: " + ", ".join(f"{k} {v}" for k, v in exits.most_common()) + ".\n")
    L.append("## Is it stable?\n")
    L.append("| | Trades | Avg R | Median R | Win rate | PF | Total R |\n|---|---|---|---|---|---|---|")
    L.append(f"| First half ({ymd(d0)} to {ymd(mid_day)}) | {fmt(stats(first))} |")
    L.append(f"| Second half | {fmt(stats(second))} |")
    for y in sorted(by_year):
        L.append(f"| {y} | {fmt(stats(by_year[y]))} |")
    L.append("\n| Setup | Trades | Avg R | Median R | Win rate | PF | Total R |\n|---|---|---|---|---|---|---|")
    for k, v in by_setup.items():
        L.append(f"| {k.title()} | {fmt(stats(v))} |")
    L.append(f"\n- Stocks traded: {len(by_sym)}; profitable in total R: {sum(1 for v in by_sym.values() if v > 0)}. The five biggest contributors made "
             f"{(100 * sum(v for _, v in top[:5]) / pos_total) if pos_total else 0:.0f}% of the profit of the profitable stocks: " + ", ".join(f"{k.replace('_NS', '')} {v:+.1f} R" for k, v in top[:5]) +
             ". The five worst: " + ", ".join(f"{k.replace('_NS', '')} {v:+.1f} R" for k, v in top[-5:][::-1]) + ".\n")
    L.append("## Reading it\n")
    L.append("- A real edge shows as a positive average R net of costs, a profit factor clearly above 1, a clear gap over BOTH controls, and the same sign in both halves and in most years. "
             "Long-only trend following also rides the market: compare with the Nifty line above and with the gate-only control.")
    L.append("- This is the technical half only. Whether quality fundamentals add anything on top cannot be backtested here; it can only be watched forward on paper.\n")
    out = os.path.join(ROOT, "reports", "screener_technical_gate_backtest.md")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w", encoding="utf-8").write("\n".join(L) + "\n")
    print("\n".join(L)[:6000])


def days_last(world: dict) -> int:
    return max(world["bench"])


if __name__ == "__main__":
    main()
