"""
Home-page section endpoints: popular, latest, completed, new.

Two rules keep the home page varied:
  1. Each section uses a DIFFERENT ordering (chapters / recent uploads / status /
     recency) and excludes titles already shown in other sections, so the rows
     don't all show the same manga.
  2. Each section is DIVERSIFIED across extensions — no single extension may
     contribute more than MAX_PER_EXTENSION titles to a section. This matters
     because one extension (e.g. MangaDex) installs 60+ per-language sources and
     would otherwise flood every row. The extension is derived from source_name
     ("MangaDex (EN)" and "MangaDex (FR)" both map to "mangadex").

Reads from PostgreSQL for speed; Latest also uses Suwayomi chapter upload dates.
"""
import os

import requests
from fastapi import APIRouter

import cache
import database

router = APIRouter(tags=["home"])

GQL = f"{os.getenv('SUWAYOMI_URL', 'http://127.0.0.1:4567')}/api/graphql"

# Columns selected everywhere, in the order _rows_to_manga expects.
_COLS = ("id, title, thumbnail_url, status, source_name, source_id, "
         "inferred_type, chapter_count")

# No extension may contribute more than this many titles to a home section.
MAX_PER_EXTENSION = 2

# Only serve rows that will actually render (a visible cover).
_HAS_THUMB = "thumbnail_url IS NOT NULL AND thumbnail_url <> ''"


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


def _extension_key(source_name: str) -> str:
    """
    Collapse a per-language source name to its extension.
    "MangaDex (EN)" -> "mangadex", "Asura Scans" -> "asura scans".
    """
    return (source_name or "").split(" (")[0].strip().lower() or "?"


def _diversify(rows: list[dict], limit: int,
               per_ext: int = MAX_PER_EXTENSION,
               exclude_titles: set[str] | None = None) -> list[dict]:
    """
    Walk rows in their given (already-ranked) order, keeping at most `per_ext`
    per extension and skipping titles in `exclude_titles`, until `limit` picked.
    """
    exclude = exclude_titles or set()
    out: list[dict] = []
    counts: dict[str, int] = {}
    for r in rows:
        title = r["title"].lower()
        if title in exclude:
            continue
        key = _extension_key(r["sourceName"])
        if counts.get(key, 0) >= per_ext:
            continue
        counts[key] = counts.get(key, 0) + 1
        out.append(r)
        if len(out) >= limit:
            break
    return out


def _titles(section: str) -> set[str]:
    """Lowercased titles currently cached for another section (for exclusion)."""
    c = cache.read(section)
    return {m["title"].lower() for m in c["mangaList"]} if c else set()


def _recent_manga_ids(fetch: int = 200) -> list[int]:
    """Manga IDs whose chapters were most recently uploaded, newest-first."""
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
    # Sources don't report chapter counts in list views (all 0), so there's no
    # popularity signal yet — show a diverse RANDOM sample, rating-first once
    # AniList ratings are populated. RANDOM() also rotates the row every cache
    # window so the home page feels fresh.
    rows = _query(f"""
        SELECT * FROM (
            SELECT DISTINCT ON (LOWER(title)) {_COLS}, rating
            FROM manga
            WHERE {_HAS_THUMB}
            ORDER BY LOWER(title), rating DESC NULLS LAST
        ) t
        ORDER BY t.rating DESC NULLS LAST, RANDOM()
        LIMIT 300
    """)
    out = {"mangaList": _diversify(rows, 12)}
    cache.write("popular", out)
    return out


@router.get("/api/latest")
def get_latest():
    cached = cache.read("latest")
    if cached is not None:
        return cached

    # Prefer manga with the most recent chapter uploads (Suwayomi), but only
    # opened manga have chapters fetched — often a single source — so top up
    # with the most recently-synced rows across every source and let _diversify
    # spread it out.
    candidates: list[dict] = []
    recent_ids = _recent_manga_ids(200)
    if recent_ids:
        id_rank = {v: i for i, v in enumerate(recent_ids)}
        recent_rows = _query(f"""
            SELECT DISTINCT ON (LOWER(title)) {_COLS}
            FROM manga
            WHERE id = ANY(%s) AND {_HAS_THUMB}
            ORDER BY LOWER(title), id
        """, (recent_ids,))
        recent_rows.sort(key=lambda r: id_rank.get(r["id"], 1_000_000))
        candidates.extend(recent_rows)

    fill = _query(f"""
        SELECT * FROM (
            SELECT DISTINCT ON (LOWER(title)) {_COLS}, updated_at
            FROM manga
            WHERE {_HAS_THUMB}
            ORDER BY LOWER(title), updated_at DESC
        ) t ORDER BY t.updated_at DESC LIMIT 800
    """)
    seen = {r["id"] for r in candidates}
    candidates.extend(r for r in fill if r["id"] not in seen)

    out = {"mangaList": _diversify(candidates, 12)}
    cache.write("latest", out)
    return out


@router.get("/api/completed")
def get_completed():
    cached = cache.read("completed")
    if cached is not None:
        return cached
    rows = _query(f"""
        SELECT * FROM (
            SELECT DISTINCT ON (LOWER(title)) {_COLS}
            FROM manga
            WHERE status = 'COMPLETED' AND {_HAS_THUMB}
            ORDER BY LOWER(title)
        ) t ORDER BY RANDOM() LIMIT 300
    """)
    out = {"mangaList": _diversify(rows, 18)}
    cache.write("completed", out)
    return out


@router.get("/api/new")
def get_new():
    cached = cache.read("new")
    if cached is not None:
        return cached

    # Newest-discovered manga (Suwayomi assigns incrementing ids), excluding
    # anything already shown in the other three sections. Warm those sections
    # first (all four load in parallel, so their caches may not exist yet);
    # each call is cached, so this is cheap.
    get_popular()
    get_latest()
    get_completed()
    exclude = _titles("popular") | _titles("latest") | _titles("completed")

    # Large pool: the newest ids are dominated by whichever source synced last
    # (MangaDex has thousands), so pull enough that every extension is present
    # for _diversify to draw 2 from each.
    rows = _query(f"""
        SELECT * FROM (
            SELECT DISTINCT ON (LOWER(title)) {_COLS}
            FROM manga
            WHERE {_HAS_THUMB}
            ORDER BY LOWER(title), id DESC
        ) t ORDER BY t.id DESC LIMIT 2000
    """)

    out = {"mangaList": _diversify(rows, 24, exclude_titles=exclude)}
    cache.write("new", out)
    return out
