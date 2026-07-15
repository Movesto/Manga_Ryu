import threading
import time

_store: dict = {}
_lock = threading.Lock()  # handlers run in many threadpool threads
TTL = 300       # seconds before a cached entry expires
MAX_SIZE = 500  # maximum entries to prevent unbounded memory growth


def read(key: str):
    with _lock:
        entry = _store.get(key)
        if not entry:
            return None
        if time.time() - entry[1] >= TTL:
            _store.pop(key, None)
            return None
        return entry[0]


def write(key: str, data):
    with _lock:
        if key not in _store and len(_store) >= MAX_SIZE:
            # Evict the single oldest entry to stay within the cap
            oldest = min(_store, key=lambda k: _store[k][1])
            del _store[oldest]
        _store[key] = (data, time.time())


def invalidate(key: str):
    with _lock:
        _store.pop(key, None)
