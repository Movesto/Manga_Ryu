import logging
import os
import contextlib
from psycopg2 import pool as pg_pool

log = logging.getLogger(__name__)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://manga:manga@localhost:5432/manga_db",
)

_pool: pg_pool.ThreadedConnectionPool | None = None


def init_pool():
    global _pool
    _pool = pg_pool.ThreadedConnectionPool(minconn=2, maxconn=20, dsn=DATABASE_URL)


@contextlib.contextmanager
def get_conn():
    conn = _pool.getconn()
    try:
        yield conn
    except Exception:
        # Roll back so an aborted transaction isn't returned to the pool
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        _pool.putconn(conn)


def create_schema():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
            CREATE TABLE IF NOT EXISTS manga (
                id              BIGINT PRIMARY KEY,
                title           TEXT   NOT NULL,
                thumbnail_url   TEXT,
                status          TEXT   DEFAULT 'UNKNOWN',
                inferred_status TEXT   DEFAULT 'ONGOING',
                author          TEXT,
                artist          TEXT,
                description     TEXT,
                source_id       TEXT,
                source_name     TEXT,
                inferred_type   TEXT   DEFAULT 'manhwa',
                url             TEXT,
                chapter_count   INTEGER DEFAULT 0,
                updated_at      TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS manga_genre (
                manga_id BIGINT REFERENCES manga(id) ON DELETE CASCADE,
                genre    TEXT   NOT NULL,
                PRIMARY KEY (manga_id, genre)
            );

            CREATE INDEX IF NOT EXISTS idx_manga_inferred_status
                ON manga(inferred_status);
            CREATE INDEX IF NOT EXISTS idx_manga_inferred_type
                ON manga(inferred_type);
            CREATE INDEX IF NOT EXISTS idx_manga_source_id
                ON manga(source_id);
            CREATE INDEX IF NOT EXISTS idx_manga_title_lower
                ON manga(lower(title));
            CREATE INDEX IF NOT EXISTS idx_manga_updated
                ON manga(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_genre_lower
                ON manga_genre(lower(genre));
            """)

            cur.execute("""
                ALTER TABLE manga
                    ADD COLUMN IF NOT EXISTS chapters_updated_at TIMESTAMPTZ;
                ALTER TABLE manga
                    ADD COLUMN IF NOT EXISTS ai_tagged BOOLEAN DEFAULT FALSE;
                ALTER TABLE manga
                    ADD COLUMN IF NOT EXISTS rating REAL;
                CREATE INDEX IF NOT EXISTS idx_manga_chapters_updated
                    ON manga(chapters_updated_at);
                CREATE INDEX IF NOT EXISTS idx_manga_ai_tagged
                    ON manga(ai_tagged) WHERE ai_tagged = FALSE;
            """)
            conn.commit()
    log.info("database schema ready")
