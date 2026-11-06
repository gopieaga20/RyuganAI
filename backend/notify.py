"""Trade alerts on Telegram: live and paper orders, stop-loss / target hits, and strong scanner calls.

Design rules:
  * the bot token and chat id come from the server's environment (.env) only, never from the database or the page;
  * sending can never break trading: every failure is swallowed, and the send runs in the background with a timeout;
  * messages are labelled LIVE or PAPER and never carry funds or account details;
  * nothing is sent until the user switches alerts on, and the same event is not sent twice (de-duplication key).
"""
import asyncio
import json
import os
import time
from collections import deque
from typing import Optional

import httpx

SETTINGS_KEY = "notify_settings"
KINDS = ("live_orders", "live_exits", "paper", "calls", "positions")
DEFAULTS = {"enabled": False, "live_orders": True, "live_exits": True, "paper": True, "calls": True, "positions": True,
            "call_min_confidence": 80, "loss_alert_pct": 5, "near_pct": 80}
SEND_TIMEOUT = 8.0
MAX_PER_MINUTE = 20

_cache = {"at": 0.0, "value": None}
_sent_keys: dict = {}
_recent: deque = deque()
_pending: set = set()


# ───────────── configuration ─────────────
def credentials() -> tuple:
    return (os.getenv("TELEGRAM_BOT_TOKEN", "").strip(), os.getenv("TELEGRAM_CHAT_ID", "").strip())


def configured() -> bool:
    token, chat = credentials()
    return bool(token and chat)


def clean_settings(raw: Optional[dict]) -> dict:
    out = dict(DEFAULTS)
    raw = raw or {}
    for k in ("enabled", *KINDS):
        if k in raw:
            out[k] = bool(raw[k])
    for key, lo, hi in (("call_min_confidence", 1.0, 100.0), ("loss_alert_pct", 1.0, 90.0), ("near_pct", 50.0, 99.0)):
        try:
            c = float(raw.get(key, out[key]))
        except (TypeError, ValueError):
            c = out[key]
        out[key] = min(hi, max(lo, c))
    return out


async def load_settings(pool, fresh: bool = False) -> dict:
    now = time.time()
    if not fresh and _cache["value"] is not None and now - _cache["at"] < 15:
        return _cache["value"]
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT value FROM app_settings WHERE key = $1", SETTINGS_KEY)
    try:
        raw = json.loads(row["value"]) if row else {}
    except (ValueError, TypeError):
        raw = {}
    _cache.update(at=now, value=clean_settings(raw))
    return _cache["value"]


async def save_settings(pool, data: dict) -> dict:
    cfg = clean_settings(data)
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                           SETTINGS_KEY, json.dumps(cfg))
    _cache.update(at=time.time(), value=cfg)
    return cfg


# ───────────── sending ─────────────
async def default_send(text: str) -> bool:
    token, chat = credentials()
    if not (token and chat):
        return False
    try:
        async with httpx.AsyncClient(timeout=SEND_TIMEOUT) as client:
            r = await client.post(f"https://api.telegram.org/bot{token}/sendMessage",
                                  json={"chat_id": chat, "text": text[:3900], "disable_web_page_preview": True})
        if r.status_code != 200:
            print(f"[WARN] Telegram refused the message (HTTP {r.status_code})")
            return False
        return True
    except Exception as e:                                   # never print the exception text: the URL contains the bot token
        print(f"[WARN] Telegram message not sent ({type(e).__name__})")
        return False


_sender = default_send


def _allowed_now() -> bool:
    now = time.time()
    while _recent and now - _recent[0] > 60:
        _recent.popleft()
    if len(_recent) >= MAX_PER_MINUTE:
        return False
    _recent.append(now)
    return True


def _is_duplicate(key: Optional[str]) -> bool:
    if not key:
        return False
    now = time.time()
    for k in [k for k, t in _sent_keys.items() if now - t > 86400]:
        _sent_keys.pop(k, None)
    if key in _sent_keys:
        return True
    _sent_keys[key] = now
    return False


async def _deliver(text: str):
    try:
        await _sender(text)
    except Exception as e:
        print(f"[WARN] alert not sent ({type(e).__name__})")


async def notify(pool, kind: str, text: str, key: Optional[str] = None) -> bool:
    """Queue one alert. Returns True when it was queued. Never raises and never waits for the network."""
    try:
        if kind not in KINDS or not configured():
            return False
        cfg = await load_settings(pool)
        if not cfg["enabled"] or not cfg.get(kind):
            return False
        if _is_duplicate(key) or not _allowed_now():
            return False
        task = asyncio.get_running_loop().create_task(_deliver(text))
        _pending.add(task)
        task.add_done_callback(_pending.discard)
        return True
    except Exception as e:
        print(f"[WARN] alert skipped ({type(e).__name__}: {e})")
        return False


async def drain():
    """Wait for queued alerts (used by tests and at shutdown)."""
    if _pending:
        await asyncio.gather(*list(_pending), return_exceptions=True)


async def send_test() -> dict:
    """The Send test button: bypasses the on/off switches so the user can check the bot is set up."""
    if not configured():
        return {"ok": False, "detail": "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not set on the server."}
    ok = await _sender("Ryugan test message: alerts are working.")
    return {"ok": bool(ok), "detail": "Sent." if ok else "Telegram did not accept the message. Check the token and chat id, and that you pressed Start in the bot chat."}


# ───────────── message text ─────────────
def _inr(v) -> str:
    try:
        return f"₹{float(v):,.2f}"
    except (TypeError, ValueError):
        return "-"


def live_order(o: dict, result: dict) -> str:
    st = result.get("state")
    head = {"PLACED": "LIVE ORDER PLACED", "REJECTED": "LIVE ORDER REFUSED", "NOT_SENT": "LIVE ORDER NOT SENT",
            "UNKNOWN": "LIVE ORDER OUTCOME UNKNOWN: check your Angel app now"}.get(st, f"LIVE ORDER {st}")
    price = f" @ {_inr(o.get('price'))}" if o.get("price") else ""
    trig = f" trigger {_inr(o.get('trigger_price'))}" if o.get("trigger_price") else ""
    rules = [f"{label} {o[k]:g}%" for k, label in (("sl_pct", "stop"), ("tp_pct", "target"), ("trail_pct", "trail")) if o.get(k)]
    lines = [head, f"{o['side']} {o['qty']} {o['symbol']}", f"{o['order_type'].replace('_', ' ')}{price}{trig} · {'Intraday' if o['product'] == 'INTRADAY' else 'Carry-forward'}"]
    if rules:
        lines.append("Exit rules: " + ", ".join(rules))
    if result.get("order_id"):
        lines.append(f"Broker order id {result['order_id']}")
    if st != "PLACED" and result.get("message"):
        lines.append(str(result["message"])[:200])
    return "\n".join(lines)


def live_exit(r: dict, action: str, qty: int, ltp: Optional[float], result: dict) -> str:
    what = {"STOP": "STOP-LOSS HIT", "TRAIL": "TRAILING STOP HIT", "TARGET": "TARGET HIT"}.get(action, action)
    st = result.get("state")
    lines = [f"LIVE {what}", f"{r['symbol']} · price {_inr(ltp)}" if ltp else str(r["symbol"])]
    if r.get("entry") is not None:
        lines.append(f"Entry {_inr(r['entry'])}")
    lines.append({"PLACED": f"Sell {qty} at market sent (order {result.get('order_id')}).",
                  "UNKNOWN": f"Sell {qty} sent but the outcome is UNKNOWN. It was NOT re-sent: check your Angel app now.",
                  }.get(st, f"Sell {qty} was {st}: {str(result.get('message') or '')[:160]}. Check your position."))
    return "\n".join(lines)


def paper_order(row: dict) -> str:
    return f"PAPER ORDER ({row.get('call', '')} {row.get('confidence', '')}%)\n{row.get('detail', '')}"


def paper_close(symbol: str, reason: str, exit_price: float, pnl: Optional[float]) -> str:
    r = str(reason).upper()
    what = "STOP-LOSS HIT" if r.startswith("SL") else "TARGET HIT" if r.startswith("TARGET") else f"CLOSED ({reason})"
    p = f"{pnl:+,.2f}" if pnl is not None else "-"
    return f"PAPER {what}\n{symbol} · exit {_inr(exit_price)}\nP&L before the exit charge: ₹{p}"


def strong_call(row: dict) -> str:
    return (f"CALL {row.get('confidence')}%: {row.get('call')} on {row.get('symbol')}\n"
            f"Price {_inr(row.get('price'))}" + (f" · news {row['news']}" if row.get("news") else "") +
            "\nA signal only, not a recommendation. Nothing was ordered because of this message.")


def position_alerts(label: str, symbol: str, entry: float, ltp: float, stop: Optional[float], target: Optional[float],
                    long: bool = True, loss_pct: float = 5.0, near_pct: float = 80.0) -> list:
    """Alerts for one open position at the current price: [(key, text)]. Each key is stable for the same situation, so the
    caller's de-duplication sends it once.
      * in a loss: first when the loss reaches `loss_pct` of the entry price, then again at every further 10% step;
      * near the stop / near the target: when the price has covered `near_pct` % of the way from the entry to that level."""
    out = []
    if not entry or not ltp:
        return out
    move = (ltp - entry) / entry * 100 if long else (entry - ltp) / entry * 100
    if move <= -loss_pct:
        step = int((-move - loss_pct) // 10)
        out.append((f"loss{step}", f"{label} POSITION IN LOSS\n{symbol}: {_inr(ltp)} vs entry {_inr(entry)} ({move:+.1f}%)"
                    + (f"\nStop-loss at {_inr(stop)}" if stop else "")))
    frac = near_pct / 100.0
    if stop and ((entry - stop) if long else (stop - entry)) > 0:
        done = ((entry - ltp) if long else (ltp - entry)) / ((entry - stop) if long else (stop - entry))
        if frac <= done < 1:
            out.append(("nearsl", f"{label} NEAR STOP-LOSS\n{symbol}: {_inr(ltp)}, stop-loss at {_inr(stop)} (entry {_inr(entry)}). {done * 100:.0f}% of the way to the stop."))
    if target and ((target - entry) if long else (entry - target)) > 0:
        done = ((ltp - entry) if long else (entry - ltp)) / ((target - entry) if long else (entry - target))
        if frac <= done < 1:
            out.append(("neartp", f"{label} NEAR TARGET\n{symbol}: {_inr(ltp)}, target at {_inr(target)} (entry {_inr(entry)}). {done * 100:.0f}% of the way to the target."))
    return out
