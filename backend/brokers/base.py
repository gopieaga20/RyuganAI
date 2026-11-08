"""The interface every live-trading broker implements.

Everything the app does with real money goes through one active broker object. The safety logic (limits, preview and confirm,
the send-once record, stop-loss/target rules, the kill switch) lives outside the brokers and does not change when a broker is added.

Rules every adapter must keep:
  * `place()` sends an order at most once. A failure that may have reached the exchange (timeout after the request was sent,
    connection reset, server error) is reported as UNKNOWN and is never retried. A reply that proves the order was refused
    before processing (bad token) may be retried once after a fresh login. A request that never left the machine is NOT_SENT.
  * the normalized shapes below are what the rest of the app reads, whatever the broker calls its fields.

Normalized order:    {order_id, symbol, side, order_type, product, variety, qty, filled, price, trigger, avg_price, status, text, time, open}
Normalized position: {symbol, exchange, product, net_qty, buy_qty, sell_qty, buy_avg, sell_avg, ltp, pnl, realised, unrealised, token}
Funds:               {available_cash, net, utilised, available_margin, raw}
Place result:        {state: PLACED|REJECTED|NOT_SENT|UNKNOWN, order_id, message, raw}
Instrument info:     {token, exch, lot_size?, ...broker specific}   (what `resolve` returns and `build_params` consumes)
"""
from typing import Optional


class Broker:
    id = "broker"
    label = "Broker"
    login = "env"                 # "env": credentials come from the server .env and login is automatic; "oauth": the user signs in on the broker's page

    # ── connection ──
    def configured(self) -> bool:
        """True when the server has what it needs (API key/secret in .env)."""
        return False

    def status(self) -> dict:
        """{id, label, login, configured, connected, account, expires, message}"""
        return {"id": self.id, "label": self.label, "login": self.login, "configured": self.configured(), "connected": False,
                "account": None, "expires": None, "message": ""}

    @property
    def needs_connect(self) -> bool:
        """True for brokers that need the user to press Connect (a daily sign-in on the broker's site)."""
        return self.login == "oauth"

    def login_url(self, state: str) -> str:
        raise NotImplementedError

    def complete_login(self, params: dict) -> dict:
        """Finish an OAuth login with the redirect's query parameters. Returns the new status."""
        raise NotImplementedError

    def restore(self, token: Optional[str], account: Optional[str], expires_ts: Optional[float]) -> None:
        """Load a saved session after a restart."""

    def session_for_storage(self) -> Optional[dict]:
        """{token, account, expires_ts} to save, or None."""
        return None

    def disconnect(self) -> None:
        pass

    # ── trading ──
    def resolve(self, symbol: str) -> Optional[dict]:
        """The app's option symbol (e.g. NIFTY10NOV2623950CE) -> this broker's instrument info, or None when unknown."""
        raise NotImplementedError

    def build_params(self, o: dict, info: dict, tag: str = "") -> dict:
        raise NotImplementedError

    def place(self, params: dict) -> dict:
        raise NotImplementedError

    def cancel(self, order_id: str, variety: str = "NORMAL") -> dict:
        raise NotImplementedError

    def order_book(self) -> list:
        raise NotImplementedError

    def positions(self) -> list:
        raise NotImplementedError

    def funds(self) -> Optional[dict]:
        raise NotImplementedError

    def ltp(self, symbol: str) -> Optional[float]:
        """Last traded price from this broker, or None (the app then falls back to its normal price sources)."""
        return None
