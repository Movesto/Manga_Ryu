from unittest.mock import MagicMock

import pytest

import database


def test_get_conn_rolls_back_on_error(monkeypatch):
    """A failed query must not return an aborted transaction to the pool."""
    conn = MagicMock()
    pool = MagicMock()
    pool.getconn.return_value = conn
    monkeypatch.setattr(database, "_pool", pool)

    with pytest.raises(ValueError):
        with database.get_conn():
            raise ValueError("query failed")

    conn.rollback.assert_called_once()
    pool.putconn.assert_called_once_with(conn)


def test_get_conn_no_rollback_on_success(monkeypatch):
    conn = MagicMock()
    pool = MagicMock()
    pool.getconn.return_value = conn
    monkeypatch.setattr(database, "_pool", pool)

    with database.get_conn() as c:
        assert c is conn

    conn.rollback.assert_not_called()
    pool.putconn.assert_called_once_with(conn)


def test_schema_includes_rating_column():
    """Regression: rating is read by /api/popular and written by ratings.py,
    so create_schema must define it."""
    import inspect

    src = inspect.getsource(database.create_schema)
    assert "rating" in src
