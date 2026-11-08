"""Which brokers exist and which one is active. One broker is active at a time; the choice is made on the Live page and can only
change while live mode is OFF."""
from typing import Optional

from .base import Broker

_brokers: dict = {}
_active_id = "angel"


def register(b: Broker) -> Broker:
    _brokers[b.id] = b
    return b


def get(broker_id: str) -> Optional[Broker]:
    return _brokers.get(broker_id)


def all_brokers() -> list:
    return list(_brokers.values())


def active_id() -> str:
    return _active_id if _active_id in _brokers else next(iter(_brokers), "angel")


def active() -> Broker:
    return _brokers[active_id()]


def set_active(broker_id: str) -> Broker:
    global _active_id
    if broker_id not in _brokers:
        raise KeyError(broker_id)
    _active_id = broker_id
    return _brokers[broker_id]


def load_defaults() -> None:
    """Register the built-in brokers (idempotent)."""
    from .angel import AngelBroker
    from .upstox import UpstoxBroker
    if "angel" not in _brokers:
        register(AngelBroker())
    if "upstox" not in _brokers:
        register(UpstoxBroker())
