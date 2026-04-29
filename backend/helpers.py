"""Shared utilities used across route modules."""
from concurrent.futures import ThreadPoolExecutor
import suwayomi


def active_sources() -> list:
    return [
        s for s in suwayomi.get_sources()
        if isinstance(s, dict)
        and str(s.get("id")) != "0"
        and s.get("name") != "Local source"
    ]


def recent_chapters(manga_id) -> list:
    try:
        data = suwayomi.get_manga_chapters(str(manga_id))
        if not isinstance(data, list) or not data:
            return []
        sorted_ch = sorted(
            [c for c in data if isinstance(c, dict)],
            key=lambda c: c.get("chapterNumber", 0),
            reverse=True,
        )
        return [
            {
                "chapterNumber": c.get("chapterNumber", 0),
                "name":          c.get("name", ""),
                "uploadDate":    c.get("uploadDate", 0),
            }
            for c in sorted_ch[:3]
        ]
    except Exception:
        return []


def enrich(manga_list: list) -> list:
    if not manga_list:
        return manga_list

    def _add(manga: dict) -> dict:
        m = dict(manga)
        m["recentChapters"] = recent_chapters(m.get("id", ""))
        return m

    with ThreadPoolExecutor(max_workers=min(len(manga_list), 20)) as ex:
        return list(ex.map(_add, manga_list))
