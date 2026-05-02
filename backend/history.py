from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from auth import CurrentUser
import database

router = APIRouter(tags=["history"])


def create_history_tables():
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
            CREATE TABLE IF NOT EXISTS reading_history (
                user_id         INTEGER NOT NULL,
                manga_id        BIGINT  NOT NULL,
                chapter_id      INTEGER NOT NULL,
                chapter_number  FLOAT,
                manga_title     TEXT,
                manga_thumbnail TEXT,
                read_at         TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (user_id, chapter_id)
            );
            CREATE INDEX IF NOT EXISTS idx_history_user_read
                ON reading_history(user_id, read_at DESC);
            CREATE INDEX IF NOT EXISTS idx_history_manga
                ON reading_history(user_id, manga_id);
            """)
            conn.commit()


class MarkReadBody(BaseModel):
    manga_id:        int
    chapter_id:      int
    chapter_number:  Optional[float] = None
    manga_title:     Optional[str]   = None
    manga_thumbnail: Optional[str]   = None


@router.post("/api/history/mark")
def mark_read(body: MarkReadBody, user: CurrentUser):
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO reading_history
                    (user_id, manga_id, chapter_id, chapter_number, manga_title, manga_thumbnail)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id, chapter_id) DO UPDATE SET read_at = NOW()
            """, (user["id"], body.manga_id, body.chapter_id, body.chapter_number,
                  body.manga_title, body.manga_thumbnail))
            conn.commit()
    return {"ok": True}


@router.get("/api/history/read-chapters/{manga_id}")
def get_read_chapters(manga_id: int, user: CurrentUser):
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT chapter_id FROM reading_history WHERE user_id = %s AND manga_id = %s",
                (user["id"], manga_id),
            )
            ids = [row[0] for row in cur.fetchall()]
    return {"readChapterIds": ids}


@router.get("/api/history")
def get_history(user: CurrentUser, limit: int = 60):
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT ON (manga_id)
                    manga_id, manga_title, manga_thumbnail,
                    chapter_id, chapter_number, read_at
                FROM reading_history
                WHERE user_id = %s
                ORDER BY manga_id, read_at DESC
            """, (user["id"],))
            rows = cur.fetchall()
    rows.sort(key=lambda r: r[5], reverse=True)
    return {
        "history": [
            {
                "mangaId":            r[0],
                "mangaTitle":         r[1],
                "mangaThumbnail":     r[2],
                "lastChapterId":      r[3],
                "lastChapterNumber":  float(r[4]) if r[4] is not None else None,
                "readAt":             r[5].isoformat() if r[5] else None,
            }
            for r in rows[:limit]
        ]
    }


@router.delete("/api/history/{manga_id}")
def delete_history(manga_id: int, user: CurrentUser):
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM reading_history WHERE user_id = %s AND manga_id = %s",
                (user["id"], manga_id),
            )
            conn.commit()
    return {"ok": True}
