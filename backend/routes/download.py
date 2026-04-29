"""
Chapter download + Kindle conversion.

Flow:
  1. Call Suwayomi's fetchChapterPages mutation → list of /api/v1/... image paths
  2. Download every page image from Suwayomi (localhost:4567) into a temp dir
  3. Run kcc-c2e on that dir → EPUB optimised for Kindle
  4. Stream the EPUB to the browser; clean up temp files after send
"""
import os
import re
import shutil
import subprocess
import tempfile
import uuid

import requests
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(tags=["download"])

SUWAYOMI = "http://127.0.0.1:4567"
GQL_URL  = f"{SUWAYOMI}/api/graphql"
KCC      = "/home/cade/.local/bin/kcc-c2e"

# Valid KCC device profiles — anything outside this list is rejected
_VALID_PROFILES = {
    "K1", "K2", "KDX", "K34", "K57", "KPW", "KV", "KPW34", "K810",
    "KO", "K11", "KPW5", "KPW6", "KS1860", "KS1920", "KS1240",
    "KS", "KCS", "KS3", "KSCS", "OTHER",
}


# ── helpers ────────────────────────────────────────────────────────────────────

def _gql(query: str, variables: dict | None = None) -> dict:
    try:
        r = requests.post(GQL_URL, json={"query": query, "variables": variables or {}}, timeout=20)
        return r.json()
    except Exception as exc:
        return {"error": str(exc)}


def _chapter_info(chapter_id: int) -> dict | None:
    result = _gql("""
        query ChapterInfo($id: Int!) {
            chapter(id: $id) {
                id
                name
                chapterNumber
                manga { id title }
            }
        }
    """, {"id": chapter_id})
    return (result.get("data") or {}).get("chapter")


def _fetch_pages(chapter_id: int) -> list[str]:
    """
    Call fetchChapterPages to get the page URL list.
    This also tells Suwayomi to cache the images if it hasn't already.
    Returns paths like ['/api/v1/manga/3/chapter/1/page/0', ...]
    """
    result = _gql("""
        mutation FetchPages($input: FetchChapterPagesInput!) {
            fetchChapterPages(input: $input) { pages }
        }
    """, {"input": {"chapterId": chapter_id}})
    pages = ((result.get("data") or {}).get("fetchChapterPages") or {}).get("pages", [])
    return pages if isinstance(pages, list) else []


def _download_pages(pages: list[str], dest_dir: str) -> None:
    """Download each page image from Suwayomi and write to dest_dir as 0001.jpg etc."""
    for i, path in enumerate(pages):
        # SSRF guard: only allow paths served by our local Suwayomi instance
        if not path.startswith("/"):
            raise HTTPException(502, f"Unexpected page URL format from Suwayomi (page {i+1})")
        url = f"{SUWAYOMI}{path}"
        r = requests.get(url, timeout=60, stream=True)
        if not r.ok:
            raise HTTPException(502, f"Suwayomi returned {r.status_code} for page {i+1}")

        content_type = r.headers.get("Content-Type", "image/jpeg")
        # derive extension: image/jpeg → jpg, image/png → png, image/webp → webp
        ext = content_type.split("/")[-1].split(";")[0].strip().lower()
        if ext in ("jpeg", "jpg"):
            ext = "jpg"
        elif ext not in ("png", "webp", "gif"):
            ext = "jpg"

        fpath = os.path.join(dest_dir, f"{i+1:04d}.{ext}")
        with open(fpath, "wb") as f:
            for chunk in r.iter_content(16384):
                f.write(chunk)


def _safe_filename(s: str) -> str:
    return re.sub(r'[^\w\s\-.]', '', s).strip()


# ── route ──────────────────────────────────────────────────────────────────────

@router.get("/api/manga/{manga_id}/chapter/{chapter_id}/download")
def download_chapter_kindle(
    manga_id: str,
    chapter_id: str,
    background_tasks: BackgroundTasks,
    profile: str = "KV",
):
    """
    Download a chapter as a Kindle-optimised EPUB.
    profile: Kindle device profile — KV (Voyage), K11, KPW5, KPW6, KO, etc.
    """
    if profile not in _VALID_PROFILES:
        raise HTTPException(400, f"Invalid Kindle profile '{profile}'. Valid options: {', '.join(sorted(_VALID_PROFILES))}")

    cid = int(chapter_id)

    # ── 1. Get chapter info ────────────────────────────────────────────────────
    info = _chapter_info(cid)
    if not info:
        raise HTTPException(404, "Chapter not found in Suwayomi")

    ch_num      = info["chapterNumber"]
    ch_name     = info.get("name") or f"Chapter {ch_num}"
    manga_title = info["manga"]["title"]

    # ── 2. Fetch page list from Suwayomi ───────────────────────────────────────
    pages = _fetch_pages(cid)
    if not pages:
        raise HTTPException(502, "No pages returned by Suwayomi — chapter may not be available")

    # ── 3. Download all pages into a temp directory ────────────────────────────
    work_dir = tempfile.mkdtemp(prefix="manga_dl_")
    out_dir  = tempfile.mkdtemp(prefix="manga_epub_")

    try:
        _download_pages(pages, work_dir)

        # ── 4. Convert with KCC ───────────────────────────────────────────────
        comic_title = f"{_safe_filename(manga_title)} - {ch_name}"
        proc = subprocess.run(
            [
                KCC,
                "-p", profile,
                "-m",               # manga style (right-to-left)
                "-f", "EPUB",
                "--nokepub",        # standard .epub, not .kepub.epub
                "-t", comic_title,
                "-o", out_dir,
                work_dir,
            ],
            capture_output=True,
            text=True,
            timeout=180,
        )
        if proc.returncode != 0:
            # Log internally but don't expose system paths / tool output to clients
            import logging
            logging.getLogger(__name__).error("KCC failed (exit %d): %s", proc.returncode, proc.stderr[-500:])
            raise HTTPException(500, "EPUB conversion failed — please try again")

        epubs = [f for f in os.listdir(out_dir) if f.lower().endswith(".epub")]
        if not epubs:
            raise HTTPException(500, "KCC produced no EPUB file")

        # Move to a stable /tmp path that outlives the temp dirs
        out_path = f"/tmp/mangaryu_{uuid.uuid4().hex}.epub"
        shutil.move(os.path.join(out_dir, epubs[0]), out_path)

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
        shutil.rmtree(out_dir,  ignore_errors=True)

    background_tasks.add_task(os.unlink, out_path)

    ch_label   = str(int(ch_num)) if ch_num == int(ch_num) else str(ch_num)
    safe_title = _safe_filename(manga_title)
    filename   = f"{safe_title} - Ch.{ch_label}.epub"

    return FileResponse(
        out_path,
        media_type="application/epub+zip",
        filename=filename,
    )
