"""
Admin-only extension management, backed by Suwayomi's GraphQL API.

Extensions provide the *sources* that sync.py ingests into Postgres, so this is
how an admin bootstraps and curates where the catalog's manga come from.
"""
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request
from ratelimit import limiter

import suwayomi
from auth import AdminUser

router = APIRouter(prefix="/api/admin/extensions", tags=["extensions"])


def _icon_path(url: str) -> str:
    """
    Normalise an extension icon URL to a root-relative path so the frontend's
    /media proxy can serve it regardless of whether Suwayomi returned an
    absolute (http://host:4567/...) or relative (/api/v1/...) URL.
    """
    if not url:
        return ""
    if url.startswith(("http://", "https://")):
        parsed = urlparse(url)
        return parsed.path + (f"?{parsed.query}" if parsed.query else "")
    return url if url.startswith("/") else f"/{url}"


def _first_error(result: dict) -> str | None:
    errs = result.get("errors")
    if errs:
        return (errs[0] or {}).get("message", "GraphQL error")
    return None


@router.get("")
def list_extensions(_: AdminUser):
    nodes = suwayomi.list_extensions_gql()
    for n in nodes:
        n["iconUrl"] = _icon_path(n.get("iconUrl", ""))
    # Installed first, then updatable, then alphabetical by name.
    nodes.sort(key=lambda n: (
        not n.get("isInstalled"),
        not n.get("hasUpdate"),
        (n.get("name") or "").lower(),
    ))
    return {"extensions": nodes}


@router.get("/repos")
def list_repos(_: AdminUser):
    return {"repos": suwayomi.list_extension_stores_gql()}


@router.post("/repos")
@limiter.limit("12/minute")
async def add_repo(request: Request, _: AdminUser):
    body = await request.json()
    url = (body.get("indexUrl") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="indexUrl is required")
    err = _first_error(suwayomi.add_extension_store_gql(url))
    if err:
        raise HTTPException(status_code=502, detail=err)
    # Pull the newly-registered store's index immediately.
    suwayomi.fetch_extensions_gql()
    return {"ok": True}


@router.post("/repos/remove")
@limiter.limit("12/minute")
async def remove_repo(request: Request, _: AdminUser):
    body = await request.json()
    url = (body.get("indexUrl") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="indexUrl is required")
    err = _first_error(suwayomi.remove_extension_store_gql(url))
    if err:
        raise HTTPException(status_code=502, detail=err)
    return {"ok": True}


@router.post("/refresh")
@limiter.limit("6/minute")
def refresh_extensions(request: Request, _: AdminUser):
    """
    Re-pull the extension index from the registered repo stores. If none are
    registered yet, auto-register the default repo(s) first — otherwise the
    fetch returns nothing (this was the original "No extensions found" bug).
    """
    if not suwayomi.list_extension_stores_gql():
        for url in suwayomi.DEFAULT_EXTENSION_REPOS:
            suwayomi.add_extension_store_gql(url)

    result = suwayomi.fetch_extensions_gql()
    err = _first_error(result)
    if err:
        raise HTTPException(status_code=502, detail=err)
    count = len((((result.get("data") or {}).get("fetchExtensions") or {}).get("extensions")) or [])
    return {"ok": True, "count": count}


@router.post("/{pkg_name}/install")
@limiter.limit("20/minute")
def install_extension(request: Request, pkg_name: str, _: AdminUser):
    result = suwayomi.set_extension_install_gql(pkg_name, install=True)
    err = _first_error(result)
    if err:
        raise HTTPException(status_code=502, detail=err)
    ext = (((result.get("data") or {}).get("updateExtension") or {}).get("extension")) or {}
    return {"ok": True, "extension": ext}


@router.post("/{pkg_name}/uninstall")
@limiter.limit("20/minute")
def uninstall_extension(request: Request, pkg_name: str, _: AdminUser):
    result = suwayomi.set_extension_install_gql(pkg_name, install=False)
    err = _first_error(result)
    if err:
        raise HTTPException(status_code=502, detail=err)
    return {"ok": True}
