import threading
from fastapi import FastAPI
from apscheduler.schedulers.background import BackgroundScheduler

import database
import sync
import auth
import bookmarks
import editors_choice
from routes import home, catalog, manga as manga_routes, download as download_routes, html_reader as html_reader_routes

app = FastAPI(title="MangaReader API")
_scheduler = BackgroundScheduler()

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(auth.router)
app.include_router(bookmarks.router)
app.include_router(editors_choice.router)
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
