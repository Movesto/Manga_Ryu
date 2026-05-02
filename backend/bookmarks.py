"""
Bookmark endpoints — all routes require authentication.
"""
from fastapi import APIRouter, HTTPException
import database
from auth import CurrentUser

router = APIRouter(prefix="/api/bookmarks", tags=["bookmarks"])


def create_bookmark_tables():
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
            CREATE TABLE IF NOT EXISTS bookmarks (
                user_id    BIGINT REFERENCES users(id)  ON DELETE CASCADE,
                manga_id   BIGINT REFERENCES manga(id)  ON DELETE CASCADE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (user_id, manga_id)
            );
            CREATE INDEX IF NOT EXISTS idx_bookmark_user ON bookmarks(user_id);
            """)
            conn.commit()


@router.get("")
def list_bookmarks(user: CurrentUser):
    uid = user["id"]
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT m.id, m.title, m.thumbnail_url, m.inferred_status,
                       m.inferred_type, m.source_name, m.chapter_count, b.created_at
                FROM bookmarks b
                JOIN manga m ON m.id = b.manga_id
                WHERE b.user_id = %s
                ORDER BY b.created_at DESC
            """, (uid,))
            rows = cur.fetchall()
            cols = ["id", "title", "thumbnailUrl", "status", "type",
                    "sourceName", "chapterCount", "bookmarkedAt"]
            results = [dict(zip(cols, r)) for r in rows]

            if results:
                manga_ids = [r["id"] for r in results]
                cur.execute("""
                    SELECT DISTINCT ON (manga_id)
                        manga_id, chapter_id, chapter_number
                    FROM reading_history
                    WHERE user_id = %s AND manga_id = ANY(%s)
                    ORDER BY manga_id, read_at DESC
                """, (uid, manga_ids))
                last_read = {row[0]: {"chapterId": row[1], "chapterNumber": float(row[2]) if row[2] else None}
                             for row in cur.fetchall()}
                for r in results:
                    lr = last_read.get(r["id"])
                    r["lastRead"] = lr
                    if lr and lr["chapterNumber"] is not None and r["chapterCount"]:
                        r["unreadCount"] = max(0, r["chapterCount"] - int(lr["chapterNumber"]))
                    else:
                        r["unreadCount"] = 0

            return results


@router.get("/{manga_id}")
def check_bookmark(manga_id: int, user: CurrentUser):
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM bookmarks WHERE user_id = %s AND manga_id = %s",
                (user["id"], manga_id),
            )
            return {"bookmarked": cur.fetchone() is not None}


@router.post("/{manga_id}", status_code=201)
def add_bookmark(manga_id: int, user: CurrentUser):
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM manga WHERE id = %s", (manga_id,))
            if not cur.fetchone():
                raise HTTPException(404, "Manga not found")
            cur.execute(
                "INSERT INTO bookmarks (user_id, manga_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (user["id"], manga_id),
            )
            conn.commit()
    return {"bookmarked": True}


@router.delete("/{manga_id}")
def remove_bookmark(manga_id: int, user: CurrentUser):
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM bookmarks WHERE user_id = %s AND manga_id = %s",
                (user["id"], manga_id),
            )
            conn.commit()
    return {"bookmarked": False}
