import time

_store: dict = {}
TTL = 300  # seconds


def read(key: str):
    entry = _store.get(key)
    if entry and time.time() - entry[1] < TTL:
        return entry[0]
    return None


def write(key: str, data):
    _store[key] = (data, time.time())


def invalidate(key: str):
    _store.pop(key, None)
