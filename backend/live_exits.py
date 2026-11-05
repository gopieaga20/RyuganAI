"""Stop-loss, target and trailing stop for REAL positions. Pure functions: no network, no database.

All percentages are plain numbers (30 means 30%). 0 or missing means "not used".
  stop   = entry x (1 - sl%)                      a fixed floor under the entry price
  trail  = highest price seen x (1 - trail%)      follows the price up and never moves down
  target = entry x (1 + tp%)
The stop used is the higher of the fixed stop and the trailing stop. The exit fires when the last price
touches the stop (action STOP, or TRAIL once the trailing stop has overtaken the fixed one) or the target.
"""
from typing import Optional

LIMITS = {"sl_pct": (1.0, 90.0), "tp_pct": (1.0, 500.0), "trail_pct": (1.0, 90.0)}
ACTIVE_STATES = ("WAITING", "ARMED")


def clean(sl, tp, trail) -> dict:
    """Return {sl_pct, tp_pct, trail_pct} as floats (0 = off). Raises ValueError with a readable reason."""
    out = {}
    for key, v in (("sl_pct", sl), ("tp_pct", tp), ("trail_pct", trail)):
        v = float(v or 0)
        lo, hi = LIMITS[key]
        if v and not (lo <= v <= hi):
            label = {"sl_pct": "Stop-loss", "tp_pct": "Target", "trail_pct": "Trailing stop"}[key]
            raise ValueError(f"{label} must be between {lo:g}% and {hi:g}% (or left empty).")
        out[key] = v
    return out


def any_rule(rule: dict) -> bool:
    return any((rule.get(k) or 0) > 0 for k in LIMITS)


def tick(p: float) -> float:
    """Round to the 0.05 option price step."""
    return round(round(p / 0.05) * 0.05, 2)


def evaluate(rule: dict, entry: float, ltp: float, peak: Optional[float] = None) -> dict:
    """One price update. Returns {action: None|'STOP'|'TRAIL'|'TARGET', peak, stop, target}."""
    peak = max(peak or entry, ltp, entry)
    sl, tp, tr = (rule.get("sl_pct") or 0), (rule.get("tp_pct") or 0), (rule.get("trail_pct") or 0)
    fixed = entry * (1 - sl / 100) if sl else None
    trail = peak * (1 - tr / 100) if tr else None
    stop = max([s for s in (fixed, trail) if s is not None], default=None)
    target = entry * (1 + tp / 100) if tp else None
    action = None
    if stop is not None and ltp <= stop:
        action = "TRAIL" if (trail is not None and (fixed is None or trail > fixed)) else "STOP"
    elif target is not None and ltp >= target:
        action = "TARGET"
    return {"action": action, "peak": round(peak, 2),
            "stop": tick(stop) if stop is not None else None, "target": tick(target) if target is not None else None}
