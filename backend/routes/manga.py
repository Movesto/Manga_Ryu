"""
Manga detail, chapters, pages, and misc Suwayomi pass-through endpoints.
"""
import time
from fastapi import APIRouter

import suwayomi
import sync
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
    return suwayomi.get_manga_details(manga_id)


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
def trigger_sync(_: AdminUser):
    import threading
    if sync._running:
        return {"status": "already_running"}
    threading.Thread(target=sync.run_sync, daemon=True).start()
    return {"status": "started"}
