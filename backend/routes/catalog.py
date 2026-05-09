"""
Browse and search — DB-backed with live Suwayomi fallback when DB is sparse.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter, Query, Request
from ratelimit import limiter

import cache
import database
import suwayomi
import sync as _sync

router = APIRouter(tags=["catalog"])


def _db_search(q: str, page: int = 1, page_size: int = 20) -> list:
    offset = (page - 1) * page_size
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT m.id, m.title, m.thumbnail_url, m.inferred_status,
                       m.source_name, m.inferred_type, m.chapter_count
                FROM manga m
                WHERE lower(m.title) LIKE lower(%s)
                ORDER BY m.updated_at DESC
                LIMIT %s OFFSET %s
                """,
                (f"%{q}%", page_size, offset),
            )
            rows = cur.fetchall()
            cols = ["id", "title", "thumbnailUrl", "status",
                    "sourceName", "type", "chapterCount"]
            return [dict(zip(cols, r)) for r in rows]


def _live_search(q: str) -> list:
    """Search all Suwayomi sources in parallel; upsert results into DB."""
    try:
        sources = suwayomi.get_sources()
    except Exception:
        return []

    active = [
        s for s in sources
        if isinstance(s, dict)
        and str(s.get("id")) != "0"
        and s.get("name") != "Local source"
    ]

    results: list = []
    seen_ids: set = set()
    to_upsert: list = []

    def _search_one(source: dict) -> list:
        sid   = str(source["id"])
        sname = source["name"]
        try:
            data = suwayomi.search_manga_in_source(sid, q)
            ml   = data.get("mangaList") or []
            for m in ml:
                m["sourceName"] = sname
            return ml
        except Exception:
            return []

    with ThreadPoolExecutor(max_workers=20) as ex:
        futures = [ex.submit(_search_one, s) for s in active]
        for fut in as_completed(futures, timeout=15):
            try:
                for m in (fut.result(timeout=2) or []):
                    mid = m.get("id")
                    if mid and mid not in seen_ids:
                        seen_ids.add(mid)
                        results.append(m)
                        to_upsert.append(m)
            except Exception:
                pass

    # Persist new finds so future DB searches are richer
    if to_upsert:
        try:
            _sync.upsert_search_results(to_upsert)
        except Exception:
            pass

    return results


@router.get("/api/search")
@limiter.limit("30/minute")
def search_manga(request: Request, q: str = "", page: int = 1):
    q = q.strip()
    if len(q) < 3:
        return {"mangaList": [], "query": q}

    cache_key = f"search:{q}:{page}"
    cached = cache.read(cache_key)
    if cached is not None:
        return cached

    # Fast DB lookup first
    db_results = _db_search(q, page)

    # If DB has enough hits or this is a deep page, skip live search
    if len(db_results) >= 5 or page > 1:
        out = {"mangaList": db_results, "query": q}
        cache.write(cache_key, out)
        return out

    # DB is sparse — fan out to all live sources
    live = _live_search(q)

    # Merge: DB first (already ranked), then live results not already present
    seen = {m["id"] for m in db_results}
    for m in live:
        if m["id"] not in seen:
            db_results.append(m)
            seen.add(m["id"])

    out = {"mangaList": db_results[:40], "query": q}
    cache.write(cache_key, out)
    return out


@router.get("/api/browse")
def get_browse(
    q:         str = Query(""),
    status:    str = Query(""),
    type:      str = Query(""),
    genre:     str = Query(""),
    page:      int = Query(1, ge=1),
    page_size: int = Query(48, ge=1, le=100),
):
    conditions = []
    params: list = []
    join_clause = ""

    if q.strip():
        conditions.append("lower(m.title) LIKE lower(%s)")
        params.append(f"%{q.strip()}%")

    if status:
        conditions.append("m.inferred_status = %s")
        params.append(status.upper())

    if type:
        conditions.append("m.inferred_type = %s")
        params.append(type.lower())

    if genre:
        join_clause = "JOIN manga_genre mg ON m.id = mg.manga_id"
        conditions.append("lower(mg.genre) = lower(%s)")
        params.append(genre)

    where  = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    offset = (page - 1) * page_size

    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT COUNT(*) FROM (
                    SELECT DISTINCT m.id FROM manga m {join_clause} {where}
                ) sub
                """,
                params,
            )
            total = cur.fetchone()[0]

            cur.execute(
                f"""
                SELECT DISTINCT ON (m.id)
                    m.id, m.title, m.thumbnail_url, m.status, m.inferred_status,
                    m.author, m.source_name, m.inferred_type, m.chapter_count,
                    m.updated_at
                FROM manga m {join_clause}
                {where}
                ORDER BY m.id, m.updated_at DESC
                LIMIT %s OFFSET %s
                """,
                params + [page_size, offset],
            )
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
            manga_list = [dict(zip(cols, r)) for r in rows]

            if manga_list:
                ids = [m["id"] for m in manga_list]
                cur.execute(
                    "SELECT manga_id, genre FROM manga_genre WHERE manga_id = ANY(%s)",
                    (ids,),
                )
                genre_map: dict = {}
                for mid, g in cur.fetchall():
                    genre_map.setdefault(mid, []).append(g)

                for m in manga_list:
                    m["genre"]       = genre_map.get(m["id"], [])
                    m["thumbnailUrl"] = m.pop("thumbnail_url", "")
                    m["sourceName"]   = m.pop("source_name", "")
                    m.pop("updated_at", None)
                    if m.get("status", "UNKNOWN") in ("UNKNOWN", "", None):
                        m["status"] = m.get("inferred_status", "ONGOING")

    total_pages = max(1, (total + page_size - 1) // page_size)
    return {
        "mangaList":  manga_list,
        "total":      total,
        "page":       page,
        "pageSize":   page_size,
        "totalPages": total_pages,
    }
