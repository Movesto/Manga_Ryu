"""
Manga detail, chapters, pages, and misc Suwayomi pass-through endpoints.
"""
import time
from fastapi import APIRouter, Request
from ratelimit import limiter

import suwayomi
import sync
import tagger
import database
from auth import AdminUser

router = APIRouter(tags=["manga"])


@router.get("/api/extensions")
def list_extensions():
    return suwayomi.get_extensions()


@router.get("/api/sources")
def list_sources():
    return suwayomi.get_sources()


@router.get("/api/library")
def check_library():
    return suwayomi.get_library()


@router.get("/api/catalog/{source_id}")
def get_catalog(source_id: str, page: int = 1):
    return suwayomi.get_popular_manga(source_id, page)


@router.get("/api/manga/{manga_id}")
def get_manga(manga_id: str):
    data = suwayomi.get_manga_details(manga_id)
    try:
        with database.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT rating FROM manga WHERE id = %s", (int(manga_id),))
                row = cur.fetchone()
                if row and row[0] is not None:
                    data["rating"] = row[0]
    except Exception:
        pass
    return data


@router.get("/api/manga/{manga_id}/chapters")
def get_chapters(manga_id: str):
    return suwayomi.get_manga_chapters(manga_id)


@router.get("/api/manga/{manga_id}/chapter/{chapter_id}")
def get_pages(manga_id: str, chapter_id: str):
    pages = suwayomi.fetch_chapter_pages_gql(chapter_id)
    if not pages:
        time.sleep(2)
        pages = suwayomi.fetch_chapter_pages_gql(chapter_id)
    return {"pageList": pages}


@router.post("/api/sync")
@limiter.limit("1/minute")
def trigger_sync(request: Request, _: AdminUser):
    import threading
    if sync._running:
        return {"status": "already_running"}
    threading.Thread(target=sync.run_sync, daemon=True).start()
    return {"status": "started"}


@router.post("/api/admin/retag")
@limiter.limit("1/minute")
def trigger_retag(request: Request, _: AdminUser):
    """
    Reset ai_tagged=FALSE on all manga and re-run the tagger.
    Use this after deploying a newly trained model.
    """
    if not tagger.is_ready():
        return {"status": "tagger_not_loaded"}
    import threading
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE manga SET ai_tagged = FALSE")
            conn.commit()
    threading.Thread(target=sync.tag_new_manga, kwargs={"batch_size": 5000}, daemon=True).start()
    return {"status": "started"}


@router.get("/api/admin/tagger/status")
def tagger_status(_: AdminUser):
    """Return whether the tagger model is loaded and how many manga need tagging."""
    result: dict = {"model_loaded": tagger.is_ready()}
    try:
        with database.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM manga WHERE ai_tagged = FALSE")
                result["untagged_count"] = cur.fetchone()[0]
    except Exception:
        pass
    return result
