"""Angel One behind the broker interface. All the real work stays in live_broker.py (order calls) and angel_broker.py (session and
contract list); this class only adapts them, so nothing about how Angel orders are sent has changed."""
from typing import Optional

import angel_broker as ab
import live_broker as lb
from .base import Broker


class AngelBroker(Broker):
    id = "angel"
    label = "Angel One"
    login = "env"

    def configured(self) -> bool:
        return bool(ab._get_credentials()) if hasattr(ab, "_get_credentials") else True

    def status(self) -> dict:
        info = ab.session_info()
        return {"id": self.id, "label": self.label, "login": self.login, "configured": self.configured(),
                "connected": bool(info.get("logged_in")), "account": None, "expires": None,
                "message": "Logs in by itself with the ANGEL_* settings in the server .env." if info.get("logged_in") else (info.get("last_error") or "Not logged in yet: check the ANGEL_* settings in the server .env.")}

    def disconnect(self) -> None:
        ab.invalidate_session()

    def resolve(self, symbol: str) -> Optional[dict]:
        return ab._master_lookup.get(symbol.upper())

    def build_params(self, o: dict, info: dict, tag: str = "") -> dict:
        return lb.build_params(o, info["token"], info["exch"], tag=tag)

    def place(self, params: dict) -> dict:
        return lb.place(params)

    def cancel(self, order_id: str, variety: str = "NORMAL") -> dict:
        return lb.cancel(order_id, variety)

    def order_book(self) -> list:
        return lb.order_book()

    def positions(self) -> list:
        return lb.positions()

    def funds(self) -> Optional[dict]:
        return lb.funds()
