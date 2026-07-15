import logging
import threading
import os
from pathlib import Path

# ── Load .env before anything else ────────────────────────────────────────────
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

# ── Structured JSON logging (configure before any module imports) ──────────────
from pythonjsonlogger import jsonlogger as _jl
_handler = logging.StreamHandler()
_handler.setFormatter(_jl.JsonFormatter("%(asctime)s %(name)s %(levelname)s %(message)s"))
logging.root.handlers = [_handler]
logging.root.setLevel(logging.INFO)

# ── Sentry error tracking (opt-in — activates only when SENTRY_DSN is set) ─────
# Init before the app is created so FastAPI/Starlette are auto-instrumented.
_sentry_dsn = os.getenv("SENTRY_DSN")
if _sentry_dsn:
    import sentry_sdk

    sentry_sdk.init(
        dsn=_sentry_dsn,
        environment=os.getenv("SENTRY_ENVIRONMENT", "production"),
        release=os.getenv("SENTRY_RELEASE") or os.getenv("IMAGE_TAG"),
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        send_default_pii=False,  # don't ship request bodies / auth headers
    )
    logging.getLogger(__name__).info("Sentry error tracking enabled")

from contextlib import asynccontextmanager

import requests as _requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from ratelimit import limiter

from apscheduler.schedulers.background import BackgroundScheduler

import database
import sync
import tagger
import auth
import audit
import ratings
import bookmarks
import editors_choice
import history
from routes import home, catalog, manga as manga_routes, download as download_routes, html_reader as html_reader_routes

_SUWAYOMI_URL = os.getenv("SUWAYOMI_URL", "http://127.0.0.1:4567")

_scheduler = BackgroundScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_pool()
    database.create_schema()
    tagger.load()
    auth.create_auth_tables()
    auth.ensure_first_admin()
    audit.create_audit_table()
    bookmarks.create_bookmark_tables()
    editors_choice.create_table()
    history.create_history_tables()
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM manga")
            manga_count = cur.fetchone()[0]
    if manga_count == 0:
        threading.Thread(target=sync.run_sync, daemon=True).start()
    _scheduler.add_job(sync.run_sync, "interval", hours=6, id="sync")
    _scheduler.add_job(sync.refresh_bookmarked_chapters, "interval", hours=12, id="chapter_refresh")
    _scheduler.add_job(ratings.fetch_and_store, "interval", weeks=1, id="ratings")
    _scheduler.start()
    yield
    _scheduler.shutdown(wait=False)


app = FastAPI(title="Manga Ryu API", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://mangaryu.org", "http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-CSRF-Token"],
)

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(auth.router)
app.include_router(bookmarks.router)
app.include_router(editors_choice.router)
app.include_router(history.router)
app.include_router(home.router)
app.include_router(catalog.router)
app.include_router(manga_routes.router)
app.include_router(download_routes.router)
app.include_router(html_reader_routes.router)

# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health_check():
    checks: dict = {}
    healthy = True

    # Database
    try:
        with database.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM manga")
                checks["database"] = {"status": "ok", "manga_count": cur.fetchone()[0]}
    except Exception as exc:
        checks["database"] = {"status": "error", "error": str(exc)[:120]}
        healthy = False

    # Suwayomi
    try:
        r = _requests.get(f"{_SUWAYOMI_URL}/api/v1/settings/about/", timeout=5)
        checks["suwayomi"] = {"status": "ok" if r.ok else "degraded", "http_status": r.status_code}
        if not r.ok:
            healthy = False
    except Exception as exc:
        checks["suwayomi"] = {"status": "error", "error": str(exc)[:120]}
        healthy = False

    checks["sync"] = {"running": sync._running}

    status_code = 200 if healthy else 503
    return JSONResponse(
        {"status": "healthy" if healthy else "degraded", "checks": checks},
        status_code=status_code,
    )
