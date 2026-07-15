import cache


def setup_function():
    cache._store.clear()


def test_read_missing_returns_none():
    assert cache.read("nope") is None


def test_write_then_read():
    cache.write("k", {"v": 1})
    assert cache.read("k") == {"v": 1}


def test_expired_entry_evicted(monkeypatch):
    cache.write("k", "data")
    key_written_at = cache._store["k"][1]
    monkeypatch.setattr(cache.time, "time", lambda: key_written_at + cache.TTL + 1)
    assert cache.read("k") is None
    assert "k" not in cache._store


def test_invalidate():
    cache.write("k", "data")
    cache.invalidate("k")
    assert cache.read("k") is None


def test_eviction_at_max_size():
    for i in range(cache.MAX_SIZE):
        cache.write(f"k{i}", i)
    assert len(cache._store) == cache.MAX_SIZE
    cache.write("overflow", "new")
    assert len(cache._store) == cache.MAX_SIZE
    assert cache.read("overflow") == "new"
    # the oldest entry was evicted
    assert cache.read("k0") is None


def test_rewrite_existing_key_does_not_evict():
    for i in range(cache.MAX_SIZE):
        cache.write(f"k{i}", i)
    cache.write("k5", "updated")
    assert len(cache._store) == cache.MAX_SIZE
    assert cache.read("k5") == "updated"
