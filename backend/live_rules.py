"""Rules for REAL-money manual orders. Pure functions: no network, no database, so every rule is unit-tested.

The first version is deliberately narrow and defensive:
  * option contracts only (NFO);
  * a BUY needs your limits to be set, must fit them, and is refused after the daily loss cap is hit;
  * a SELL can only close a long position you already hold (no writing / naked shorts);
  * orders are only accepted while the exchange is open;
  * limit prices far from the last traded price are refused (fat-finger guard).
"""
import datetime as dt
from typing import Optional

import live_exits

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

ORDER_TYPES = ("LIMIT", "MARKET", "STOPLOSS_LIMIT", "STOPLOSS_MARKET")
PRODUCTS = ("INTRADAY", "CARRYFORWARD")        # Angel's names for MIS and NRML
SIDES = ("BUY", "SELL")

DEFAULT_TOLERANCE_PCT = 20.0                   # a limit price more than this far from the last price is refused


def market_open(now: dt.datetime) -> bool:
    m = now.hour * 60 + now.minute
    return now.weekday() < 5 and 9 * 60 + 15 <= m < 15 * 60 + 30


def limits_ready(limits: Optional[dict]) -> bool:
    return bool(limits) and all((limits.get(k) or 0) > 0 for k in ("max_order_value", "max_lots", "max_daily_loss"))


def estimate_charges(side: str, value: float) -> float:
    """Rough all-in charges for one option order (brokerage, STT on sells, exchange fee, GST, stamp). An estimate for the
    confirmation screen only; the contract note is the truth."""
    brokerage = 20.0
    stt = value * 0.000625 if side == "SELL" else 0.0
    exch = value * 0.0003503
    gst = (brokerage + exch) * 0.18
    stamp = value * 0.00003 if side == "BUY" else 0.0
    return round(brokerage + stt + exch + gst + stamp, 2)


def validate_order(o: dict, ctx: dict) -> dict:
    """Check one order. `o`: {symbol, side, qty, order_type, product, price, trigger_price}.
    `ctx`: {limits, contract_found, lot_size, ltp, net_long_qty, day_loss, now, tolerance_pct}.
    Returns {ok, errors[], warnings[], est{price, value, lots, charges}}."""
    errors, warnings = [], []
    limits = ctx.get("limits") or {}
    side, otype, product = o.get("side"), o.get("order_type"), o.get("product")
    qty = int(o.get("qty") or 0)
    price = float(o.get("price") or 0)
    trigger = float(o.get("trigger_price") or 0)
    lot = int(ctx.get("lot_size") or 0)
    ltp = float(ctx.get("ltp") or 0)
    tol = float(ctx.get("tolerance_pct") or DEFAULT_TOLERANCE_PCT)

    if not limits_ready(limits):
        errors.append("Set your live trading limits first (maximum order value, maximum lots and daily loss cap). Until then every live order is refused.")
    if not ctx.get("contract_found"):
        errors.append(f"{o.get('symbol')} is not a known NSE option contract.")
    if side not in SIDES:
        errors.append("Side must be BUY or SELL.")
    if otype not in ORDER_TYPES:
        errors.append(f"Order type must be one of {', '.join(ORDER_TYPES)}.")
    if product not in PRODUCTS:
        errors.append("Product must be INTRADAY or CARRYFORWARD.")
    if qty <= 0:
        errors.append("Quantity must be at least 1.")
    if not lot:
        errors.append("The lot size for this contract is unknown, so the quantity cannot be checked.")
    elif qty > 0 and qty % lot:
        errors.append(f"Quantity {qty} is not a whole number of lots (lot size {lot}).")
    lots = qty // lot if lot else 0
    if limits_ready(limits) and lots > limits["max_lots"] and side == "BUY":
        errors.append(f"{lots} lots is above your limit of {limits['max_lots']} lots per order.")

    now = ctx.get("now") or dt.datetime.now(IST)
    if not market_open(now):
        errors.append("The exchange is closed (open 09:15-15:30 IST, Monday to Friday). Live orders are only accepted while it is open.")

    if not ltp:
        errors.append("No live price for this contract right now, so the order cannot be checked.")

    if otype in ("LIMIT", "STOPLOSS_LIMIT") and price <= 0:
        errors.append("A limit price is required.")
    for label, v in (("price", price), ("trigger price", trigger)):
        if v > 0 and abs(round(v / 0.05) * 0.05 - v) > 1e-6:
            errors.append(f"The {label} {v} is not a valid option price: prices move in steps of 0.05.")
    if otype in ("STOPLOSS_LIMIT", "STOPLOSS_MARKET") and trigger <= 0:
        errors.append("A trigger price is required for a stop-loss order.")
    if ltp and otype == "LIMIT" and price > 0 and abs(price - ltp) / ltp * 100 > tol:
        errors.append(f"Price {price:.2f} is more than {tol:.0f}% away from the last traded price {ltp:.2f}. Check for a typing mistake.")
    if otype == "STOPLOSS_LIMIT" and price > 0 and trigger > 0 and abs(price - trigger) / trigger * 100 > tol:
        # a stop's trigger is normally well away from the last price, so the limit is compared with its own trigger instead
        errors.append(f"The limit price {price:.2f} is more than {tol:.0f}% away from the trigger {trigger:.2f}. Check for a typing mistake.")
    if ltp and trigger > 0 and otype in ("STOPLOSS_LIMIT", "STOPLOSS_MARKET"):
        if side == "SELL" and trigger >= ltp:
            errors.append(f"A sell stop-loss must trigger BELOW the last price {ltp:.2f}; {trigger:.2f} would trigger at once.")
        if side == "BUY" and trigger <= ltp:
            errors.append(f"A buy stop-loss must trigger ABOVE the last price {ltp:.2f}; {trigger:.2f} would trigger at once.")
    if otype == "MARKET":
        warnings.append("A market order on an option can fill far from the last price when the spread is wide. A limit order is safer.")

    if side == "SELL":
        held = int(ctx.get("net_long_qty") or 0)
        if held < qty:
            errors.append(f"You hold {held} units long in this contract with this product, so selling {qty} would open a short position. "
                          "Selling to open (writing options) is not allowed here.")
    if side == "BUY":
        if limits_ready(limits) and (ctx.get("day_loss") or 0) >= limits["max_daily_loss"]:
            errors.append(f"Today's loss ({ctx['day_loss']:,.0f}) has reached your daily cap of {limits['max_daily_loss']:,.0f}. New buy orders are blocked until tomorrow.")

    rule = {k: o.get(k) or 0 for k in ("sl_pct", "tp_pct", "trail_pct")}
    if live_exits.any_rule(rule):
        if side != "BUY":
            errors.append("Stop-loss, target and trailing rules can only be attached to a BUY.")
        else:
            try:
                live_exits.clean(rule["sl_pct"], rule["tp_pct"], rule["trail_pct"])
            except ValueError as e:
                errors.append(str(e))
            warnings.append("Stop, target and trailing stop are watched by this server: they only work while the server is running, live mode is ON and the exchange is open.")

    est_price = price if (price > 0 and otype in ("LIMIT", "STOPLOSS_LIMIT")) else (ltp * 1.05 if side == "BUY" else ltp)
    value = round(est_price * qty, 2)
    if side == "BUY" and limits_ready(limits) and value > limits["max_order_value"]:
        errors.append(f"Order value {value:,.0f} is above your limit of {limits['max_order_value']:,.0f} per order.")
    if product == "CARRYFORWARD":
        warnings.append("Carry-forward (NRML) positions stay open overnight and through expiry. Make sure you will manage this one.")

    return {"ok": not errors, "errors": errors, "warnings": warnings,
            "est": {"price": round(est_price, 2), "value": value, "lots": lots, "charges": estimate_charges(side or "BUY", value)}}
