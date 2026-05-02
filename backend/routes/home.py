"""
Home-page section endpoints: popular, latest, completed, new releases.
- Reads from PostgreSQL for speed; uses Suwayomi chapter dates for Latest.
- All sections deduplicate by title so the same manga never appears twice.
- Only English-only sources with working thumbnails and chapters are served.
"""
import requests
from fastapi import APIRouter

import cache
import database

router = APIRouter(tags=["home"])

GQL = "http://127.0.0.1:4567/api/graphql"


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


def _recent_manga_ids(fetch: int = 120) -> list[int]:
    """
    Ask Suwayomi for manga whose chapters were most recently uploaded.
    Returns manga IDs ordered newest-first, deduplicated.
    """
    try:
        resp = requests.post(
            GQL,
            json={"query": f"""{{
                chapters(orderBy: UPLOAD_DATE, orderByType: DESC, first: {fetch}) {{
                    nodes {{ mangaId }}
                }}
            }}"""},
            timeout=5,
        )
        nodes = (resp.json().get("data") or {}).get("chapters", {}).get("nodes", [])
        seen: set[int] = set()
        ids: list[int] = []
        for n in nodes:
            mid = n.get("mangaId")
            if mid and mid not in seen:
                seen.add(mid)
                ids.append(mid)
        return ids
    except Exception:
        return []


@router.get("/api/popular")
def get_popular():
    cached = cache.read("popular")
    if cached is not None:
        return cached
    # Prefer highly rated manga (AniList 85+/100); fall back to any known-status manga
    rows = _query("""
        SELECT DISTINCT ON (LOWER(title))
            id, title, thumbnail_url, status, source_name, source_id, inferred_type, chapter_count
        FROM manga
        WHERE rating >= 85
          AND status NOT IN ('UNKNOWN', 'ON_HIATUS', 'CANCELLED')
        ORDER BY LOWER(title), rating DESC
        LIMIT 60
    """)
    if len(rows) < 12:
        rows = _query("""
            SELECT DISTINCT ON (LOWER(title))
                id, title, thumbnail_url, status, source_name, source_id, inferred_type, chapter_count
            FROM manga
            WHERE status NOT IN ('UNKNOWN', 'ON_HIATUS', 'CANCELLED')
            ORDER BY LOWER(title), RANDOM()
            LIMIT 60
        """)
    import random
    random.shuffle(rows)
    out = {"mangaList": rows[:12]}
    cache.write("popular", out)
    return out


@router.get("/api/latest")
def get_latest():
    cached = cache.read("latest")
    if cached is not None:
        return cached

    recent_ids = _recent_manga_ids(120)

    if len(recent_ids) >= 12:
        id_rank = {v: i for i, v in enumerate(recent_ids)}
        rows = _query("""
            SELECT DISTINCT ON (LOWER(title))
                id, title, thumbnail_url, status, source_name, source_id, inferred_type, chapter_count
            FROM manga
            WHERE id = ANY(%s) AND status NOT IN ('UNKNOWN', 'ON_HIATUS', 'CANCELLED')
            ORDER BY LOWER(title), id
        """, (recent_ids,))
        rows.sort(key=lambda r: id_rank.get(r["id"], 9999))
        rows = rows[:12]
    else:
        rows = _query("""
            SELECT DISTINCT ON (LOWER(title))
                id, title, thumbnail_url, status, source_name, source_id, inferred_type, chapter_count
            FROM manga
            WHERE status NOT IN ('UNKNOWN', 'ON_HIATUS', 'CANCELLED')
            ORDER BY LOWER(title), updated_at DESC
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
        SELECT DISTINCT ON (LOWER(title))
            id, title, thumbnail_url, status, source_name, source_id, inferred_type, chapter_count
        FROM manga
        WHERE status = 'COMPLETED'
        ORDER BY LOWER(title), RANDOM()
        LIMIT 60
    """)
    import random
    random.shuffle(rows)
    out = {"mangaList": rows[:18]}
    cache.write("completed", out)
    return out


@router.get("/api/new")
def get_new():
    cached = cache.read("new")
    if cached is not None:
        return cached

    # Exclude titles already in Latest so New and Latest don't overlap
    latest = cache.read("latest")
    latest_titles: set[str] = set()
    if latest:
        latest_titles = {m["title"].lower() for m in latest["mangaList"]}

    rows = _query("""
        SELECT DISTINCT ON (LOWER(title))
            id, title, thumbnail_url, status, source_name, source_id, inferred_type, chapter_count
        FROM manga
        WHERE status NOT IN ('UNKNOWN', 'ON_HIATUS', 'CANCELLED')
        ORDER BY LOWER(title), RANDOM()
        LIMIT 120
    """)

    # Filter out titles already in Latest, then take first 24
    rows = [r for r in rows if r["title"].lower() not in latest_titles][:24]

    out = {"mangaList": rows}
    cache.write("new", out)
    return out
