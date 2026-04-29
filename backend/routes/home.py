"""
Home-page section endpoints: popular, latest, completed, new releases.
Each section is cached for 5 minutes and limited to 1 manga per source.
"""
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter

import cache
import suwayomi
import helpers

router = APIRouter(tags=["home"])


# ── popular ───────────────────────────────────────────────────────────────────

def _fetch_popular(source: dict) -> list:
    data = suwayomi.get_popular_manga(source["id"])
    if not isinstance(data, dict) or "mangaList" not in data or data.get("success") is False:
        return []
    ml = data["mangaList"][:1]
    for m in ml:
        m["sourceName"] = source["name"]
    return ml


@router.get("/api/popular")
def get_popular():
    cached = cache.read("popular")
    if cached is not None:
        return cached
    sources = helpers.active_sources()
    results: list = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for r in ex.map(_fetch_popular, sources):
            results.extend(r)
    out = {"mangaList": helpers.enrich(results[:12])}
    cache.write("popular", out)
    return out


# ── latest ────────────────────────────────────────────────────────────────────

def _fetch_latest(source: dict) -> list:
    data = suwayomi.get_latest_manga(source["id"])
    if not isinstance(data, dict) or "mangaList" not in data or data.get("success") is False:
        return []
    ml = data["mangaList"][:1]
    for m in ml:
        m["sourceName"] = source["name"]
    return ml


@router.get("/api/latest")
def get_latest():
    cached = cache.read("latest")
    if cached is not None:
        return cached
    sources = helpers.active_sources()
    results: list = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for r in ex.map(_fetch_latest, sources):
            results.extend(r)
    out = {"mangaList": helpers.enrich(results[:12])}
    cache.write("latest", out)
    return out


# ── completed ─────────────────────────────────────────────────────────────────

def _fetch_completed(source: dict) -> list:
    try:
        sid     = source["id"]
        filters = suwayomi.get_source_filters(sid)
        gql_filters = []
        modified = False

        if isinstance(filters, list):
            for idx, f in enumerate(filters):
                f_type = f.get("type")
                target = f.get("filter") if "filter" in f else f
                name   = str(target.get("name", "")).lower()
                if "status" in name:
                    if f_type == "Select" and isinstance(target.get("values"), list):
                        vl = [str(v).lower() for v in target["values"]]
                        if "completed" in vl:
                            gql_filters.append({"position": idx, "selectState": vl.index("completed")})
                            modified = True
                    elif f_type == "Group" and isinstance(target.get("state"), list):
                        gs = [
                            {"position": i, "state": True}
                            for i, cb in enumerate(target["state"])
                            if "completed" in str(
                                (cb.get("filter") if "filter" in cb else cb).get("name", "")
                            ).lower()
                        ]
                        if gs:
                            gql_filters.append({"position": idx, "groupState": gs})
                            modified = True

        if not modified:
            return []

        data = suwayomi.search_graphql(sid, gql_filters)
        fs   = (data.get("data") or {}).get("fetchSourceManga") or {}
        ml   = fs.get("mangas", []) if isinstance(fs, dict) else []
        if ml and not data.get("errors"):
            pick = ml[:3]
            for m in pick:
                m["sourceName"] = source["name"]
            return pick
    except Exception:
        pass
    return []


@router.get("/api/completed")
def get_completed():
    cached = cache.read("completed")
    if cached is not None:
        return cached
    sources = helpers.active_sources()
    results: list = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for r in ex.map(_fetch_completed, sources):
            results.extend(r)
    out = {"mangaList": helpers.enrich(results[:60])}
    cache.write("completed", out)
    return out


# ── new series ────────────────────────────────────────────────────────────────

def _fetch_new(source: dict) -> list:
    try:
        sid     = source["id"]
        filters = suwayomi.get_source_filters(sid)
        gql_filters = []
        modified = False

        if isinstance(filters, list):
            for idx, f in enumerate(filters):
                f_type = f.get("type")
                target = f.get("filter") if "filter" in f else f
                name   = str(target.get("name", "")).lower()
                if "sort" in name or "order" in name:
                    if f_type == "Select" and isinstance(target.get("values"), list):
                        vl = [str(v).lower() for v in target["values"]]
                        ni = next(
                            (i for i, v in enumerate(vl) if v in {"newest", "new", "created"}), -1
                        )
                        if ni != -1:
                            gql_filters.append({"position": idx, "selectState": ni})
                            modified = True

        if not modified:
            return []

        data = suwayomi.search_graphql(sid, gql_filters)
        fs   = (data.get("data") or {}).get("fetchSourceManga") or {}
        ml   = fs.get("mangas", []) if isinstance(fs, dict) else []
        if ml and not data.get("errors"):
            pick = ml[:3]
            for m in pick:
                m["sourceName"] = source["name"]
            return pick
    except Exception:
        pass
    return []


@router.get("/api/new")
def get_new():
    cached = cache.read("new")
    if cached is not None:
        return cached
    sources = helpers.active_sources()
    results: list = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for r in ex.map(_fetch_new, sources):
            results.extend(r)
    out = {"mangaList": helpers.enrich(results[:60])}
    cache.write("new", out)
    return out
