"""
Chapter download + Kindle conversion.

Job-based flow:
  1. POST .../download?profile=X  → starts background conversion, returns {job_id}
  2. GET  /api/jobs/{id}           → poll status {status, stage, progress}
  3. GET  /api/jobs/{id}/file      → stream EPUB once status == "done"

Webtoon/manhwa strips are auto-detected and split into panel-sized pages.
"""
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid

import requests
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import FileResponse
from ratelimit import limiter

router = APIRouter(tags=["download"])
log = logging.getLogger(__name__)

SUWAYOMI = os.getenv("SUWAYOMI_URL", "http://127.0.0.1:4567")
GQL_URL  = f"{SUWAYOMI}/api/graphql"
KCC      = os.getenv("KCC_PATH", "/home/cade/.local/bin/kcc-c2e")

_VALID_PROFILES = {
    "K1", "K2", "KDX", "K34", "K57", "KPW", "KV", "KPW34", "K810",
    "KO", "K11", "KPW5", "KPW6", "KS1860", "KS1920", "KS1240",
    "KS", "KCS", "KS3", "KSCS", "OTHER",
}

_WEBTOON_RATIO = 2.0
_JOB_TTL = 1800  # seconds before a completed/failed job is reaped

# ── in-memory job store ───────────────────────────────────────────────────────

_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def _set_job(job_id: str, **kwargs) -> None:
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(kwargs)


def _cleanup_old_jobs() -> None:
    now = time.time()
    with _jobs_lock:
        stale = [k for k, v in _jobs.items() if now - v.get("created_at", 0) > _JOB_TTL]
        for k in stale:
            fp = _jobs[k].get("file_path")
            if fp:
                try:
                    os.unlink(fp)
                except OSError:
                    pass
            del _jobs[k]


# ── GQL helpers ───────────────────────────────────────────────────────────────

def _gql(query: str, variables: dict | None = None) -> dict:
    try:
        r = requests.post(GQL_URL, json={"query": query, "variables": variables or {}}, timeout=20)
        return r.json()
    except Exception as exc:
        return {"error": str(exc)}


def _chapter_info(chapter_id: int) -> dict | None:
    result = _gql("""
        query ChapterInfo($id: Int!) {
            chapter(id: $id) { id name chapterNumber manga { id title } }
        }
    """, {"id": chapter_id})
    return (result.get("data") or {}).get("chapter")


def _fetch_pages(chapter_id: int) -> list[str]:
    result = _gql("""
        mutation FetchPages($input: FetchChapterPagesInput!) {
            fetchChapterPages(input: $input) { pages }
        }
    """, {"input": {"chapterId": chapter_id}})
    pages = ((result.get("data") or {}).get("fetchChapterPages") or {}).get("pages", [])
    return pages if isinstance(pages, list) else []


# ── image helpers ─────────────────────────────────────────────────────────────

def _download_pages(pages: list[str], dest_dir: str, job_id: str | None = None) -> None:
    total = len(pages)
    for i, path in enumerate(pages):
        if not path.startswith("/"):
            raise ValueError(f"Unexpected page URL format (page {i + 1})")
        r = requests.get(f"{SUWAYOMI}{path}", timeout=60, stream=True)
        if not r.ok:
            raise ValueError(f"Suwayomi returned {r.status_code} for page {i + 1}")

        ct = r.headers.get("Content-Type", "image/jpeg")
        ext = ct.split("/")[-1].split(";")[0].strip().lower()
        if ext in ("jpeg", "jpg"):
            ext = "jpg"
        elif ext not in ("png", "webp", "gif"):
            ext = "jpg"

        fpath = os.path.join(dest_dir, f"{i + 1:04d}.{ext}")
        with open(fpath, "wb") as f:
            for chunk in r.iter_content(16384):
                f.write(chunk)

        if job_id:
            pct = 15 + int((i + 1) / total * 65)
            _set_job(job_id, progress=pct, stage=f"Downloading pages ({i + 1}/{total})")


def _is_webtoon(pages_dir: str) -> bool:
    try:
        from PIL import Image
        files = sorted(f for f in os.listdir(pages_dir) if not f.startswith("."))
        if not files:
            return False
        with Image.open(os.path.join(pages_dir, files[0])) as img:
            w, h = img.size
            return w > 0 and (h / w) > _WEBTOON_RATIO
    except Exception:
        return False


def _safe_filename(s: str) -> str:
    return re.sub(r'[^\w\s\-.]', '', s).strip()


def _chapter_meta_bulk(chapter_ids: list[int]) -> list[dict]:
    """Return [{id, title, chapterNum, mangaTitle}, ...] in order."""
    out = []
    for cid in chapter_ids:
        res = _gql("""
            query CM($id: Int!) {
                chapter(id: $id) { id name chapterNumber manga { title } }
            }
        """, {"id": cid})
        ch = (res.get("data") or {}).get("chapter")
        if ch:
            n = ch.get("chapterNumber", 0)
            label = str(int(n)) if n == int(n) else str(n)
            out.append({
                "id":         cid,
                "title":      ch.get("name") or f"Chapter {label}",
                "chapterNum": label,
                "mangaTitle": ch["manga"]["title"],
            })
    return out


def _images_to_pdf(image_paths: list[str], out_path: str) -> None:
    from PIL import Image
    pages = []
    for p in image_paths:
        img = Image.open(p)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        pages.append(img)
    if not pages:
        raise ValueError("No images to convert")
    pages[0].save(
        out_path,
        format="PDF",
        save_all=True,
        append_images=pages[1:],
    )


# ── PDF worker ────────────────────────────────────────────────────────────────

def _run_pdf(job_id: str, manga_id: str, chapter_ids: list[int]) -> None:
    _cleanup_old_jobs()
    work_dir = tempfile.mkdtemp(prefix="manga_pdf_")
    try:
        _set_job(job_id, stage="Getting chapter info...", progress=3)
        metas = _chapter_meta_bulk(chapter_ids)
        if not metas:
            _set_job(job_id, status="error", stage="No chapters found", progress=0)
            return

        manga_title = metas[0]["mangaTitle"]
        all_image_paths: list[str] = []
        total_chs = len(metas)

        for ch_i, meta in enumerate(metas):
            base_pct = 5 + int(ch_i / total_chs * 80)
            _set_job(job_id,
                     stage=f"Fetching {meta['title']} ({ch_i + 1}/{total_chs})...",
                     progress=base_pct)
            pages = _fetch_pages(meta["id"])
            if not pages:
                _set_job(job_id, status="error",
                         stage=f"No pages for {meta['title']} — try again in a minute",
                         progress=0)
                return

            ch_dir = os.path.join(work_dir, f"ch{ch_i:03d}")
            os.makedirs(ch_dir)
            total_pages = len(pages)
            for p_i, path in enumerate(pages):
                if not path.startswith("/"):
                    continue
                r = requests.get(f"{SUWAYOMI}{path}", timeout=60, stream=True)
                if not r.ok:
                    continue
                ct  = r.headers.get("Content-Type", "image/jpeg")
                ext = ct.split("/")[-1].split(";")[0].strip().lower()
                ext = "jpg" if ext in ("jpeg", "jpg") else (ext if ext in ("png", "webp") else "jpg")
                fpath = os.path.join(ch_dir, f"{p_i + 1:04d}.{ext}")
                with open(fpath, "wb") as f:
                    for chunk in r.iter_content(16384):
                        f.write(chunk)
                pct = base_pct + int((p_i + 1) / total_pages * (80 // total_chs))
                _set_job(job_id,
                         stage=f"{meta['title']}: page {p_i + 1}/{total_pages}",
                         progress=min(85, pct))

            ch_files = sorted(
                os.path.join(ch_dir, f) for f in os.listdir(ch_dir) if not f.startswith(".")
            )
            all_image_paths.extend(ch_files)

        _set_job(job_id, stage="Building PDF...", progress=88)
        out_path = f"/tmp/mangaryu_{job_id}.pdf"
        _images_to_pdf(all_image_paths, out_path)

        nums = [m["chapterNum"] for m in metas]
        label = f"Ch.{nums[0]}" if len(nums) == 1 else f"Ch.{nums[0]}-{nums[-1]}"
        filename = f"{_safe_filename(manga_title)} - {label}.pdf"

        _set_job(job_id, status="done", stage="Ready", progress=100,
                 file_path=out_path, filename=filename)

    except Exception as exc:
        log.exception("PDF job %s failed", job_id)
        _set_job(job_id, status="error", stage=str(exc)[:120], progress=0)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


# ── conversion worker (runs in background thread) ─────────────────────────────

def _run_conversion(job_id: str, manga_id: str, chapter_id: str, profile: str) -> None:
    _cleanup_old_jobs()
    work_dir = tempfile.mkdtemp(prefix="manga_dl_")
    out_dir  = tempfile.mkdtemp(prefix="manga_epub_")

    try:
        _set_job(job_id, stage="Getting chapter info...", progress=3)
        info = _chapter_info(int(chapter_id))
        if not info:
            _set_job(job_id, status="error", stage="Chapter not found in Suwayomi", progress=0)
            return

        ch_num      = info["chapterNumber"]
        ch_name     = info.get("name") or f"Chapter {ch_num}"
        manga_title = info["manga"]["title"]

        _set_job(job_id, stage="Fetching page list...", progress=8)
        pages = _fetch_pages(int(chapter_id))
        if not pages:
            _set_job(job_id, status="error",
                     stage="No pages found — chapter may not be available yet. Try again in a minute.",
                     progress=0)
            return

        _set_job(job_id, stage=f"Downloading pages (0/{len(pages)})", progress=15)
        _download_pages(pages, work_dir, job_id=job_id)

        _set_job(job_id, stage="Analyzing format...", progress=81)
        webtoon = _is_webtoon(work_dir)

        _set_job(job_id, stage="Converting for Kindle...", progress=83)
        comic_title = f"{_safe_filename(manga_title)} - {ch_name}"
        kcc_cmd = [
            KCC,
            "-p", profile,
            "-f", "EPUB",
            "--nokepub",
            "-q",
            "-u",
            "-c", "2",
            "-t", comic_title,
            "-o", out_dir,
        ]
        if webtoon:
            kcc_cmd.append("-w")
        else:
            kcc_cmd.append("-m")
        kcc_cmd.append(work_dir)

        proc = subprocess.run(kcc_cmd, capture_output=True, text=True, timeout=300)  # nosemgrep: dangerous-subprocess-use-tainted-env-args
        if proc.returncode != 0:
            log.error("KCC failed (exit %d) job=%s: %s", proc.returncode, job_id, proc.stderr[-800:])
            _set_job(job_id, status="error", stage="KCC conversion failed — please try again", progress=0)
            return

        epubs = [f for f in os.listdir(out_dir) if f.lower().endswith(".epub")]
        if not epubs:
            _set_job(job_id, status="error", stage="No EPUB produced by KCC", progress=0)
            return

        out_path = f"/tmp/mangaryu_{job_id}.epub"
        shutil.move(os.path.join(out_dir, epubs[0]), out_path)

        ch_label = str(int(ch_num)) if ch_num == int(ch_num) else str(ch_num)
        filename = f"{_safe_filename(manga_title)} - Ch.{ch_label}.epub"

        _set_job(job_id, status="done", stage="Ready", progress=100,
                 file_path=out_path, filename=filename)

    except Exception as exc:
        log.exception("Conversion job %s failed", job_id)
        _set_job(job_id, status="error", stage=str(exc)[:120], progress=0)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
        shutil.rmtree(out_dir,  ignore_errors=True)


# ── routes ────────────────────────────────────────────────────────────────────

@router.post("/api/manga/{manga_id}/chapter/{chapter_id}/download")
@limiter.limit("5/minute")
def start_download(request: Request, manga_id: str, chapter_id: str, profile: str = "KPW5"):
    """Start a background Kindle conversion job. Returns {job_id} immediately."""
    if profile not in _VALID_PROFILES:
        raise HTTPException(400, f"Invalid profile '{profile}'")

    job_id = uuid.uuid4().hex
    with _jobs_lock:
        _jobs[job_id] = {
            "status":     "pending",
            "stage":      "Queued...",
            "progress":   0,
            "file_path":  None,
            "filename":   None,
            "created_at": time.time(),
        }

    threading.Thread(
        target=_run_conversion,
        args=(job_id, manga_id, chapter_id, profile),
        daemon=True,
    ).start()

    return {"job_id": job_id}


@router.post("/api/manga/{manga_id}/download/pdf")
@limiter.limit("5/minute")
def start_pdf_download(request: Request, manga_id: str, body: dict):
    """Start a PDF export job for one or more chapters. Returns {job_id}."""
    chapter_ids = body.get("chapter_ids", [])
    if not chapter_ids:
        raise HTTPException(400, "chapter_ids must not be empty")
    if len(chapter_ids) > 20:
        raise HTTPException(400, "Maximum 20 chapters per PDF")

    job_id = uuid.uuid4().hex
    with _jobs_lock:
        _jobs[job_id] = {
            "status":     "pending",
            "stage":      "Queued...",
            "progress":   0,
            "file_path":  None,
            "filename":   None,
            "created_at": time.time(),
        }
    threading.Thread(
        target=_run_pdf,
        args=(job_id, manga_id, chapter_ids),
        daemon=True,
    ).start()
    return {"job_id": job_id}


@router.get("/api/jobs/{job_id}")
def get_job_status(job_id: str):
    """Poll a conversion job's status."""
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found or expired")
    return {
        "status":   job["status"],
        "stage":    job["stage"],
        "progress": job["progress"],
    }


@router.get("/api/jobs/{job_id}/file")
def get_job_file(job_id: str, background_tasks: BackgroundTasks):
    """Stream the finished EPUB. Only valid when status == done."""
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found or expired")
    if job["status"] != "done" or not job.get("file_path"):
        raise HTTPException(409, "File not ready yet")

    file_path = job["file_path"]
    filename  = job["filename"] or "chapter.epub"

    def _cleanup():
        try:
            os.unlink(file_path)
        except OSError:
            pass
        with _jobs_lock:
            _jobs.pop(job_id, None)

    if filename.endswith(".html"):
        media_type = "text/html; charset=utf-8"
    elif filename.endswith(".pdf"):
        media_type = "application/pdf"
    else:
        media_type = "application/epub+zip"
    background_tasks.add_task(_cleanup)
    return FileResponse(file_path, media_type=media_type, filename=filename)
