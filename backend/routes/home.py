"""
Home-page section endpoints: popular, latest, completed, new releases.
Reads from PostgreSQL (populated by the sync job) — fast even on cold start.
"""
from fastapi import APIRouter

import cache
import database

router = APIRouter(tags=["home"])

_COLS = ["id", "title", "thumbnailUrl", "status", "sourceName",
         "sourceId", "inferredType", "chapterCount"]

def _rows_to_manga(rows) -> list[dict]:
    return [
        {
            "id":           r[0],
            "title":        r[1],
            "thumbnailUrl": r[2],
            "status":       r[3],
            "sourceName":   r[4],
            "sourceId":     r[5],
            "inferredType": r[6],
            "chapterCount": r[7],
        }
        for r in rows
    ]


def _query(sql: str, params=()) -> list[dict]:
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return _rows_to_manga(cur.fetchall())


@router.get("/api/popular")
def get_popular():
    cached = cache.read("popular")
    if cached is not None:
        return cached
    rows = _query("""
        SELECT id, title, thumbnail_url, status, source_name, source_id, inferred_type, chapter_count
        FROM manga
        ORDER BY RANDOM()
        LIMIT 12
    """)
    out = {"mangaList": rows}
    cache.write("popular", out)
    return out


@router.get("/api/latest")
def get_latest():
    cached = cache.read("latest")
    if cached is not None:
        return cached
    rows = _query("""
        SELECT id, title, thumbnail_url, status, source_name, source_id, inferred_type, chapter_count
        FROM manga
        ORDER BY updated_at DESC, id DESC
        LIMIT 12
    """)
    out = {"mangaList": rows}
    cache.write("latest", out)
    return out


@router.get("/api/completed")
def get_completed():
    cached = cache.read("completed")
    if cached is not None:
        return cached
    rows = _query("""
        SELECT id, title, thumbnail_url, status, source_name, source_id, inferred_type, chapter_count
        FROM manga
        WHERE status = 'COMPLETED'
        ORDER BY RANDOM()
        LIMIT 18
    """)
    out = {"mangaList": rows}
    cache.write("completed", out)
    return out


@router.get("/api/new")
def get_new():
    cached = cache.read("new")
    if cached is not None:
        return cached
    rows = _query("""
        SELECT id, title, thumbnail_url, status, source_name, source_id, inferred_type, chapter_count
        FROM manga
        ORDER BY id DESC
        LIMIT 24
    """)
    out = {"mangaList": rows}
    cache.write("new", out)
    return out
