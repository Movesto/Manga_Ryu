"""
Audit log — persists significant events (auth, admin actions) to the DB.
Each row is append-only: never update or delete audit rows.
"""
import json
import logging

import database

log = logging.getLogger(__name__)


def create_audit_table() -> None:
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id      BIGSERIAL PRIMARY KEY,
                ts      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                action  TEXT        NOT NULL,
                actor   TEXT,
                target  TEXT,
                ip      TEXT,
                detail  JSONB
            );
            CREATE INDEX IF NOT EXISTS idx_audit_ts     ON audit_log(ts DESC);
            CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_log(actor);
            CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
            """)
            conn.commit()


def log_event(
    action: str,
    *,
    actor: str | None = None,
    target: str | None = None,
    ip: str | None = None,
    detail: dict | None = None,
) -> None:
    """Write one audit row. Silently swallows exceptions so callers never crash."""
    try:
        with database.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO audit_log (action, actor, target, ip, detail)"
                    " VALUES (%s, %s, %s, %s, %s)",
                    (action, actor, target, ip, json.dumps(detail) if detail else None),
                )
                conn.commit()
    except Exception:
        log.exception("audit write failed: action=%s actor=%s", action, actor)
