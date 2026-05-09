"""
Fetches manga ratings from AniList and stores them in the DB.
AniList scores are 0–100; we store them as-is (e.g. 87.5).
Run: python ratings.py  — or scheduled weekly from main.py
"""
import logging
import time

import requests

import database

log = logging.getLogger(__name__)

ANILIST = "https://graphql.anilist.co"
QUERY = """
query ($page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(type: MANGA, sort: SCORE_DESC, isAdult: false) {
      averageScore
      title { romaji english native }
      synonyms
    }
  }
}
"""


def _fetch_page(page: int) -> tuple[list[dict], bool]:
    try:
        r = requests.post(
            ANILIST,
            json={"query": QUERY, "variables": {"page": page}},
            timeout=15,
        )
        if r.status_code == 429:
            time.sleep(60)
            return [], True
        data = r.json().get("data", {}).get("Page", {})
        has_next = data.get("pageInfo", {}).get("hasNextPage", False)
        return data.get("media", []), has_next
    except Exception as e:
        log.error("ratings fetch error page %d: %s", page, e)
        return [], False


def _all_titles(entry: dict) -> list[str]:
    t = entry.get("title", {})
    out = []
    for v in [t.get("english"), t.get("romaji"), t.get("native")]:
        if v:
            out.append(v.lower().strip())
    for s in entry.get("synonyms") or []:
        if s:
            out.append(s.lower().strip())
    return out


def fetch_and_store(max_pages: int = 40):
    """Fetch top-rated manga from AniList and upsert ratings into DB."""
    if database._pool is None:
        database.init_pool()

    # Build title → score map
    score_map: dict[str, float] = {}
    log.info("ratings: fetching up to %d pages from AniList", max_pages)
    for page in range(1, max_pages + 1):
        media, has_next = _fetch_page(page)
        for entry in media:
            score = entry.get("averageScore")
            if not score:
                continue
            for title in _all_titles(entry):
                if title not in score_map:
                    score_map[title] = float(score)
        log.debug("ratings: page %d — %d entries, map size %d", page, len(media), len(score_map))
        if not has_next:
            break
        time.sleep(0.7)  # stay within AniList rate limit

    log.info("ratings: built score map with %d titles", len(score_map))

    # Match against DB titles
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, title FROM manga")
            rows = cur.fetchall()

    updates: list[tuple[float, int]] = []
    for mid, title in rows:
        key = title.lower().strip()
        score = score_map.get(key)
        if score is not None:
            updates.append((score, mid))

    log.info("ratings: matched %d manga, updating DB", len(updates))
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            from psycopg2.extras import execute_values
            execute_values(
                cur,
                "UPDATE manga SET rating = v.score FROM (VALUES %s) AS v(score, id) WHERE manga.id = v.id",
                updates,
                template="(%s::float, %s::bigint)",
            )
            conn.commit()

    log.info("ratings: done — %d ratings stored", len(updates))


if __name__ == "__main__":
    fetch_and_store()
