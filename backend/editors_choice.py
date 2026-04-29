"""
Editor's Choice — curated manga list managed via the admin UI.
Any authenticated user can edit the list (local app, single-user).
"""
from typing import List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import cache
import database
import helpers
from auth import AdminUser

router = APIRouter(prefix="/api/editors-choice", tags=["editors-choice"])


def create_table():
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
            CREATE TABLE IF NOT EXISTS editors_choice (
                manga_id  BIGINT REFERENCES manga(id) ON DELETE CASCADE,
                position  INTEGER NOT NULL DEFAULT 0,
                added_at  TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (manga_id)
            );
            """)
            conn.commit()


# ── read ──────────────────────────────────────────────────────────────────────

@router.get("")
def get_editors_choice():
    cached = cache.read("editors_choice")
    if cached is not None:
        return cached

    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT m.id, m.title, m.thumbnail_url, m.inferred_status,
                       m.source_name, m.inferred_type, m.chapter_count
                FROM editors_choice ec
                JOIN manga m ON m.id = ec.manga_id
                ORDER BY ec.position ASC, ec.added_at ASC
            """)
            rows = cur.fetchall()
            cols = ["id", "title", "thumbnailUrl", "status",
                    "sourceName", "type", "chapterCount"]
            manga_list = [dict(zip(cols, r)) for r in rows]

    enriched = helpers.enrich(manga_list)
    out = {"mangaList": enriched}
    cache.write("editors_choice", out)
    return out


# ── write (auth required) ────────────────────────────────────────────────────

@router.post("/{manga_id}", status_code=201)
def add_pick(manga_id: int, user: AdminUser):
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM manga WHERE id = %s", (manga_id,))
            if not cur.fetchone():
                raise HTTPException(404, "Manga not found in library")
            cur.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM editors_choice")
            next_pos = cur.fetchone()[0]
            cur.execute(
                "INSERT INTO editors_choice (manga_id, position) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (manga_id, next_pos),
            )
            conn.commit()
    cache.invalidate("editors_choice")
    return {"success": True}


@router.delete("/{manga_id}")
def remove_pick(manga_id: int, user: AdminUser):
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM editors_choice WHERE manga_id = %s", (manga_id,))
            conn.commit()
    cache.invalidate("editors_choice")
    return {"success": True}


class ReorderBody(BaseModel):
    manga_ids: List[int]


@router.put("/reorder")
def reorder_picks(body: ReorderBody, user: AdminUser):
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            for pos, mid in enumerate(body.manga_ids):
                cur.execute(
                    "UPDATE editors_choice SET position = %s WHERE manga_id = %s",
                    (pos, mid),
                )
            conn.commit()
    cache.invalidate("editors_choice")
    return {"success": True}
