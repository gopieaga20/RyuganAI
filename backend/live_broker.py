"""Angel One order placement for REAL trading. The only module that sends real orders.

Design rules:
  * an order is sent at most once. If the request fails in a way that could have reached the exchange (timeout, connection
    reset) the result is UNKNOWN and nothing is retried: the user checks the order book. The single exception is a reply
    that says the login token is bad, which means the order was refused before it was processed, so it is retried once
    after a fresh login;
  * read calls (order book, positions, funds) use the normal self-renewing session helper.
"""
from typing import Optional

import angel_broker as ab


def build_params(o: dict, token: str, exchange: str = "NFO", tag: str = "") -> dict:
    """Angel placeOrder parameters for one validated order. All values are strings, as the API expects."""
    otype = o["order_type"]
    p = {
        "variety": "STOPLOSS" if otype.startswith("STOPLOSS") else "NORMAL",
        "tradingsymbol": o["symbol"],
        "symboltoken": str(token),
        "transactiontype": o["side"],
        "exchange": exchange,
        "ordertype": otype,
        "producttype": o["product"],
        "duration": "DAY",
        "price": "0" if otype in ("MARKET", "STOPLOSS_MARKET") else f"{float(o['price']):.2f}",
        "squareoff": "0",
        "stoploss": "0",
        "quantity": str(int(o["qty"])),
    }
    if otype.startswith("STOPLOSS"):
        p["triggerprice"] = f"{float(o['trigger_price']):.2f}"
    if tag:
        p["ordertag"] = tag[:20]
    return p


def place(params: dict) -> dict:
    """Send one order. Returns {'state': PLACED|REJECTED|NOT_SENT|UNKNOWN, 'order_id', 'unique_id', 'message', 'raw'}."""
    client = ab.get_angel_client()
    if not client:
        return {"state": "NOT_SENT", "message": "No Angel session (check the ANGEL_* credentials)."}
    for attempt in (1, 2):
        try:
            resp = client.placeOrderFullResponse(dict(params))
        except Exception as e:                       # may or may not have reached the exchange: never retry
            return {"state": "UNKNOWN", "message": f"The request failed after it may have been sent ({e}). Check the order book before doing anything else."}
        if isinstance(resp, dict) and resp.get("status") and (resp.get("data") or {}).get("orderid"):
            d = resp["data"]
            return {"state": "PLACED", "order_id": str(d["orderid"]), "unique_id": d.get("uniqueorderid"), "message": resp.get("message", ""), "raw": resp}
        if attempt == 1 and isinstance(resp, dict) and ab._is_session_error(resp):
            ab.invalidate_session()
            client = ab.get_angel_client()
            if client:
                continue                            # the order was refused for a bad token, so sending it again is safe
        msg = (resp or {}).get("message") if isinstance(resp, dict) else None
        return {"state": "REJECTED", "message": msg or "The broker refused the order.", "raw": resp}
    return {"state": "REJECTED", "message": "The broker refused the order."}


def cancel(order_id: str, variety: str = "NORMAL") -> dict:
    res = ab.call_angel("cancelOrder", order_id=order_id, variety=variety)
    ok = bool(isinstance(res, dict) and res.get("status"))
    return {"ok": ok, "message": (res or {}).get("message") if isinstance(res, dict) else "No Angel session", "raw": res}


def _rows(res) -> list:
    return list((res or {}).get("data") or []) if isinstance(res, dict) else []


def order_book() -> list:
    return [normalize_order(r) for r in _rows(ab.call_angel("orderBook"))]


def positions() -> list:
    return [normalize_position(r) for r in _rows(ab.call_angel("position"))]


def funds() -> Optional[dict]:
    res = ab.call_angel("rmsLimit")
    d = (res or {}).get("data") if isinstance(res, dict) else None
    if not d:
        return None
    f = lambda k: _num(d.get(k))
    return {"available_cash": f("availablecash"), "net": f("net"), "utilised": f("utilisedamount") or f("utiliseddebits"),
            "available_margin": f("availablelimitmargin") or f("availableintradaypayin"), "raw": d}


def _num(v) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def normalize_order(r: dict) -> dict:
    status = str(r.get("orderstatus") or r.get("status") or "").lower()
    return {
        "order_id": str(r.get("orderid") or ""), "symbol": r.get("tradingsymbol"), "side": r.get("transactiontype"),
        "order_type": r.get("ordertype"), "product": r.get("producttype"), "variety": r.get("variety") or "NORMAL",
        "qty": int(_num(r.get("quantity")) or 0), "filled": int(_num(r.get("filledshares")) or 0),
        "price": _num(r.get("price")), "trigger": _num(r.get("triggerprice")), "avg_price": _num(r.get("averageprice")),
        "status": status, "text": r.get("text") or "", "time": r.get("updatetime") or r.get("ordertime") or "",
        # an order can still be cancelled while it is open or waiting for its trigger
        "open": status in ("open", "pending", "trigger pending", "validation pending", "open pending", "modify pending", "put order req received", "after market order req received"),
    }


def normalize_position(r: dict) -> dict:
    net = int(_num(r.get("netqty")) or 0)
    ltp = _num(r.get("ltp"))
    pnl = _num(r.get("pnl"))
    return {
        "symbol": r.get("tradingsymbol"), "exchange": r.get("exchange"), "product": r.get("producttype"),
        "net_qty": net, "buy_qty": int(_num(r.get("buyqty")) or 0), "sell_qty": int(_num(r.get("sellqty")) or 0),
        "buy_avg": _num(r.get("buyavgprice")), "sell_avg": _num(r.get("sellavgprice")), "ltp": ltp, "pnl": pnl,
        "realised": _num(r.get("realised")), "unrealised": _num(r.get("unrealised")), "token": r.get("symboltoken"),
    }
