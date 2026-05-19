"""
Syncs manga from all Suwayomi sources into PostgreSQL.
Fetches popular + latest pages from every source (up to MAX_PAGES each),
plus completed where the source supports it.
"""
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor

import suwayomi
import database
import tagger
from psycopg2.extras import execute_values

MAX_POPULAR_PAGES = 25   # up to 25 × 20 = 500 manga per source
MAX_LATEST_PAGES  = 15
MAX_COMPLETED_PAGES = 15

_lock    = threading.Lock()
_running = False

_refresh_lock    = threading.Lock()
_refresh_running = False

# ── type inference ────────────────────────────────────────────────────────────

_MANHUA_SRC  = ["manhua", "top manhua", "wecomics", "toonily", "hiperdex"]
_MANHWA_SRC  = ["asura", "kayn", "qi", "reaper", "flame", "luminous", "leviatan",
                "void", "realm", "manga demon", "mangabuddy", "武人", "bato"]
_WEBTOON_SRC = ["webtoon", "lezhin"]

def _infer_type(source_name: str, genres: list[str]) -> str:
    src = source_name.lower()
    gl  = [g.lower() for g in genres]
    if any(k in src for k in _MANHUA_SRC)  or any("manhua" in g for g in gl):  return "manhua"
    if any(k in src for k in _WEBTOON_SRC) or any("webtoon" in g for g in gl): return "webtoon"
    if any(k in src for k in _MANHWA_SRC)  or any("manhwa" in g for g in gl):  return "manhwa"
    # Mangakakalot / Manganato / Mangafreak → typically Japanese manga
    if any(k in src for k in ["mangakakalot", "manganato", "mangafreak", "mangasee",
                               "mangapill", "mangadex"]):
        return "manga"
    return "manhwa"  # safe default for English aggregators

# ── upsert helpers ────────────────────────────────────────────────────────────

def _upsert_batch(manga_list: list, inferred_status: str):
    rows, genre_rows = [], []

    for m in manga_list:
        if not isinstance(m, dict):
            continue
        mid = m.get("id")
        if not mid:
            continue

        genres: list[str] = [g for g in (m.get("genre") or []) if isinstance(g, str)]
        src_name = str(m.get("sourceName") or "")
        itype    = _infer_type(src_name, genres)

        rows.append((
            int(mid),
            (m.get("title") or "")[:500],
            m.get("thumbnailUrl"),
            m.get("status") or "UNKNOWN",
            inferred_status,
            m.get("author"),
            m.get("artist"),
            m.get("description"),
            str(m.get("sourceId") or ""),
            src_name,
            itype,
            m.get("url"),
            int(m.get("chapterCount") or 0),
        ))
        for g in genres:
            genre_rows.append((int(mid), g.strip()[:100]))

    if not rows:
        return

    try:
        with database.get_conn() as conn:
            with conn.cursor() as cur:
                execute_values(cur, """
                    INSERT INTO manga
                        (id, title, thumbnail_url, status, inferred_status,
                         author, artist, description, source_id, source_name,
                         inferred_type, url, chapter_count)
                    VALUES %s
                    ON CONFLICT (id) DO UPDATE SET
                        title           = EXCLUDED.title,
                        thumbnail_url   = EXCLUDED.thumbnail_url,
                        status          = CASE
                            WHEN EXCLUDED.status NOT IN ('UNKNOWN','')
                            THEN EXCLUDED.status
                            ELSE manga.status
                        END,
                        inferred_status = EXCLUDED.inferred_status,
                        author          = COALESCE(EXCLUDED.author,    manga.author),
                        artist          = COALESCE(EXCLUDED.artist,    manga.artist),
                        description     = COALESCE(EXCLUDED.description, manga.description),
                        source_name     = EXCLUDED.source_name,
                        inferred_type   = EXCLUDED.inferred_type,
                        url             = EXCLUDED.url,
                        chapter_count   = GREATEST(EXCLUDED.chapter_count, manga.chapter_count),
                        updated_at      = NOW()
                """, rows)

                if genre_rows:
                    execute_values(cur, """
                        INSERT INTO manga_genre (manga_id, genre) VALUES %s
                        ON CONFLICT DO NOTHING
                    """, genre_rows)

                conn.commit()
    except Exception:
        traceback.print_exc()

# ── per-source sync ───────────────────────────────────────────────────────────

def _sync_source(source: dict):
    sid   = str(source["id"])
    sname = source["name"]

    def _fetch_pages(fetch_fn, max_pages: int, label: str, inferred_status: str):
        for page in range(1, max_pages + 1):
            try:
                data = fetch_fn(sid, page)
                if not isinstance(data, dict):
                    break
                ml = data.get("mangaList")
                if not ml:
                    break
                for m in ml:
                    m["sourceName"] = sname
                _upsert_batch(ml, inferred_status)
                if not data.get("hasNextPage", False):
                    break
            except Exception:
                break

    _fetch_pages(suwayomi.get_popular_manga, MAX_POPULAR_PAGES, "popular", "ONGOING")
    _fetch_pages(suwayomi.get_latest_manga,  MAX_LATEST_PAGES,  "latest",  "ONGOING")

    # Completed — try source-specific filter approach
    try:
        filters = suwayomi.get_source_filters(sid)
        graphql_filters = []
        modified = False

        if isinstance(filters, list):
            for index, f in enumerate(filters):
                f_type = f.get("type")
                target = f.get("filter") if "filter" in f else f
                name   = str(target.get("name", "")).lower()
                if "status" in name:
                    if f_type == "Select" and isinstance(target.get("values"), list):
                        vl = [str(v).lower() for v in target["values"]]
                        if "completed" in vl:
                            graphql_filters.append({"position": index, "selectState": vl.index("completed")})
                            modified = True
                    elif f_type == "Group" and isinstance(target.get("state"), list):
                        gs = [{"position": i, "state": True}
                              for i, cb in enumerate(target["state"])
                              if "completed" in str((cb.get("filter") if "filter" in cb else cb).get("name","")).lower()]
                        if gs:
                            graphql_filters.append({"position": index, "groupState": gs})
                            modified = True

        if modified:
            for page in range(1, MAX_COMPLETED_PAGES + 1):
                data = suwayomi.search_graphql(sid, graphql_filters, page)
                fs   = (data.get("data") or {}).get("fetchSourceManga") or {}
                ml   = fs.get("mangas", []) if isinstance(fs, dict) else []
                if ml and not data.get("errors"):
                    for m in ml:
                        m["sourceName"] = sname
                        m["status"]     = "COMPLETED"
                    _upsert_batch(ml, "COMPLETED")
                if not fs.get("hasNextPage", False):
                    break
    except Exception:
        pass

# ── public helpers ───────────────────────────────────────────────────────────

def upsert_search_results(manga_list: list):
    """Persist live search finds so future DB queries pick them up."""
    _upsert_batch(manga_list, "ONGOING")


def tag_new_manga(batch_size: int = 200):
    """
    Find manga with ai_tagged=FALSE and run genre predictions on them.
    Predicted genres are inserted into manga_genre (existing source genres
    are never overwritten — ON CONFLICT DO NOTHING).
    """
    if not tagger.is_ready():
        return

    try:
        with database.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, title, description
                    FROM manga
                    WHERE ai_tagged = FALSE
                      AND description IS NOT NULL
                      AND description != ''
                    LIMIT %s
                """, (batch_size,))
                rows = cur.fetchall()

        if not rows:
            return

        print(f"[sync] Auto-tagging {len(rows)} manga …")
        tagged = 0

        for manga_id, title, description in rows:
            try:
                tags = tagger.predict(title or "", description or "")
                with database.get_conn() as conn:
                    with conn.cursor() as cur:
                        if tags:
                            execute_values(cur, """
                                INSERT INTO manga_genre (manga_id, genre)
                                VALUES %s
                                ON CONFLICT DO NOTHING
                            """, [(manga_id, tag) for tag in tags])
                        cur.execute(
                            "UPDATE manga SET ai_tagged = TRUE WHERE id = %s",
                            (manga_id,),
                        )
                        conn.commit()
                tagged += 1
            except Exception:
                traceback.print_exc()

        print(f"[sync] Auto-tagged {tagged}/{len(rows)} manga.")
    except Exception:
        traceback.print_exc()


def refresh_bookmarked_chapters():
    """
    For every bookmarked manga whose chapters haven't been refreshed in the
    last 12 hours, force Suwayomi to pull fresh chapter data from the source
    and update chapter_count in the DB.
    """
    global _refresh_running
    with _refresh_lock:
        if _refresh_running:
            print("[sync] Chapter refresh already running, skipping.")
            return
        _refresh_running = True

    try:
        with database.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT DISTINCT b.manga_id
                    FROM bookmarks b
                    JOIN manga m ON m.id = b.manga_id
                    WHERE m.chapters_updated_at IS NULL
                       OR m.chapters_updated_at < NOW() - INTERVAL '12 hours'
                """)
                manga_ids = [row[0] for row in cur.fetchall()]

        if not manga_ids:
            print("[sync] Chapter refresh: no stale bookmarked manga.")
            return

        print(f"[sync] Refreshing chapters for {len(manga_ids)} bookmarked manga …")
        updated = 0

        for manga_id in manga_ids:
            try:
                chapters = suwayomi.fetch_chapters_fresh(str(manga_id))
                if not chapters:
                    continue
                count = len(chapters)
                with database.get_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute("""
                            UPDATE manga
                            SET chapter_count       = GREATEST(chapter_count, %s),
                                chapters_updated_at = NOW()
                            WHERE id = %s
                        """, (count, manga_id))
                        conn.commit()
                updated += 1
            except Exception:
                traceback.print_exc()

        print(f"[sync] Chapter refresh done. Updated {updated}/{len(manga_ids)} manga.")
    except Exception:
        traceback.print_exc()
    finally:
        with _refresh_lock:
            _refresh_running = False


# ── public entry point ────────────────────────────────────────────────────────

def run_sync():
    global _running
    with _lock:
        if _running:
            print("[sync] Already running, skipping.")
            return
        _running = True

    try:
        sources = suwayomi.get_sources()
        active  = [
            s for s in sources
            if isinstance(s, dict)
            and str(s.get("id")) != "0"
            and s.get("name") != "Local source"
        ]
        print(f"[sync] Starting sync for {len(active)} sources …")

        with ThreadPoolExecutor(max_workers=5) as ex:
            ex.map(_sync_source, active)

        with database.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM manga")
                total = cur.fetchone()[0]
        print(f"[sync] Done. DB now has {total} manga.")
        tag_new_manga()
    except Exception:
        traceback.print_exc()
    finally:
        with _lock:
            _running = False
