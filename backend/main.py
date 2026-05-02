import threading
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env if present
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())
from apscheduler.schedulers.background import BackgroundScheduler

import database
import sync
import auth
import bookmarks
import editors_choice
import history
from routes import home, catalog, manga as manga_routes, download as download_routes, html_reader as html_reader_routes

app = FastAPI(title="Manga Ryu API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://mangaryu.org", "http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
_scheduler = BackgroundScheduler()

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

# ── Startup / shutdown ────────────────────────────────────────────────────────

@app.on_event("startup")
def on_startup():
    database.init_pool()
    database.create_schema()
    auth.create_auth_tables()
    auth.ensure_first_admin()
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
    _scheduler.start()


@app.on_event("shutdown")
def on_shutdown():
    _scheduler.shutdown(wait=False)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health_check():
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM manga")
            total = cur.fetchone()[0]
    return {"status": "online", "manga_in_db": total, "sync_running": sync._running}
