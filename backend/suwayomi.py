import os
import requests

_SUWAYOMI = os.getenv("SUWAYOMI_URL", "http://127.0.0.1:4567")
BASE_URL = f"{_SUWAYOMI}/api/v1"


def graphql(query: str, variables: dict | None = None, timeout: int = 20) -> dict:
    """
    POST a GraphQL query/mutation to Suwayomi. Always returns a dict; on network
    failure returns an {"errors": [...]} shape so callers can treat it uniformly.
    """
    try:
        resp = requests.post(
            f"{_SUWAYOMI}/api/graphql",
            json={"query": query, "variables": variables or {}},
            timeout=timeout,
        )
        return resp.json()
    except Exception as e:
        return {"errors": [{"message": str(e)}]}

def safe_fetch(endpoint):
    """
    A helper function that catches HTML errors and prevents 
    the 'Expecting value: line 1 column 1' crash.
    """
    url = f"{BASE_URL}/{endpoint}"
    try:
        response = requests.get(url, timeout=10)
        
        # Check if the response is actually JSON before parsing
        if "application/json" in response.headers.get("Content-Type", ""):
            return response.json()
        else:
            return {
                "success": False, 
                "error": "Endpoint returned HTML or text instead of JSON.",
                "status_code": response.status_code,
                "url": url
            }
            
    except Exception as e:
        return {"success": False, "error": str(e)}

# --- SUWAYOMI COMPONENTS ---

def get_extensions():
    # Adding /list to get the JSON array of extensions
    return safe_fetch("extension/list")

def get_sources():
    # Adding /list to get the JSON array of installed sources
    return safe_fetch("source/list")

def get_library():
    # Maps to the "Library" tab
    return safe_fetch("library/list")

def get_history():
    # Maps to the "History" tab
    return safe_fetch("history/list")

def get_updates():
    # Maps to the "Updates" tab
    return safe_fetch("update/list")
def get_downloads():
    # Maps to the "Download" queue
    return safe_fetch("download/list")

def get_popular_manga(source_id: str, page: int = 1):
    """
    Fetches the popular manga catalog from a specific source.
    """
    # Notice how we format the string exactly like the Kotlin pathParams dictated
    endpoint = f"source/{source_id}/popular/{page}"
    return safe_fetch(endpoint)

def get_manga_details(manga_id: str):
    """
    Fetches the full details for a specific manga (description, author, etc.)
    """
    endpoint = f"manga/{manga_id}"
    return safe_fetch(endpoint)

def get_manga_chapters(manga_id: str):
    """
    Fetches the complete list of chapters for a specific manga.
    Falls back to the GQL fetchChapters mutation if the REST endpoint
    returns nothing (manga not yet cached in Suwayomi's local DB).
    """
    result = safe_fetch(f"manga/{manga_id}/chapters")
    if isinstance(result, list) and result:
        return result

    # REST returned empty or error — trigger a chapter fetch from the source
    url = f"{_SUWAYOMI}/api/graphql"
    query = """
    mutation FetchChapters($input: FetchChaptersInput!) {
      fetchChapters(input: $input) {
        chapters {
          id url name uploadDate chapterNumber scanlator mangaId
          isRead lastPageRead isDownloaded isBookmarked fetchedAt
        }
      }
    }
    """
    try:
        resp = requests.post(
            url,
            json={"query": query, "variables": {"input": {"mangaId": int(manga_id)}}},
            timeout=20,
        )
        chapters = (
            ((resp.json().get("data") or {}).get("fetchChapters") or {})
            .get("chapters", [])
        )
        if isinstance(chapters, list):
            # Normalise GQL fields to match the REST shape the frontend expects
            out = []
            for c in chapters:
                out.append({
                    "id":            c.get("id"),
                    "url":           c.get("url"),
                    "name":          c.get("name"),
                    "uploadDate":    c.get("uploadDate"),
                    "chapterNumber": c.get("chapterNumber"),
                    "scanlator":     c.get("scanlator"),
                    "mangaId":       c.get("mangaId"),
                    "read":          c.get("isRead", False),
                    "bookmarked":    c.get("isBookmarked", False),
                    "lastPageRead":  c.get("lastPageRead", 0),
                    "fetchedAt":     c.get("fetchedAt"),
                })
            return out
    except Exception:
        pass
    return []

def get_chapter_pages(manga_id: str, chapter_id: str):
    """
    Fetches the list of page images for a specific chapter.
    """
    endpoint = f"manga/{manga_id}/chapter/{chapter_id}"
    return safe_fetch(endpoint)

def fetch_chapter_pages_gql(chapter_id: str) -> list:
    """
    Call the GraphQL fetchChapterPages mutation to get page image URLs.
    This also triggers Suwayomi to start downloading the images from the source.
    The chapter_id must be the Suwayomi database chapter id (integer).
    Returns a list of relative URL paths like ['/api/v1/manga/1/chapter/164/page/0', ...]
    """
    url = f"{_SUWAYOMI}/api/graphql"
    query = """
    mutation FetchPages($input: FetchChapterPagesInput!) {
      fetchChapterPages(input: $input) {
        pages
      }
    }
    """
    payload = {
        "operationName": "FetchPages",
        "query": query,
        "variables": {"input": {"chapterId": int(chapter_id)}},
    }
    try:
        response = requests.post(url, json=payload)
        data = response.json()
        pages = ((data.get("data") or {}).get("fetchChapterPages") or {}).get("pages", [])
        return pages if isinstance(pages, list) else []
    except Exception:
        return []

def fetch_chapters_fresh(manga_id: str) -> list:
    """
    Force Suwayomi to pull the chapter list from the source (not its cache)
    and return the chapters. Used for proactive chapter refresh.
    """
    url = f"{_SUWAYOMI}/api/graphql"
    query = """
    mutation FetchChapters($input: FetchChaptersInput!) {
      fetchChapters(input: $input) {
        chapters { id chapterNumber }
      }
    }
    """
    try:
        resp = requests.post(
            url,
            json={"query": query, "variables": {"input": {"mangaId": int(manga_id)}}},
            timeout=30,
        )
        chapters = (
            ((resp.json().get("data") or {}).get("fetchChapters") or {})
            .get("chapters", [])
        )
        return chapters if isinstance(chapters, list) else []
    except Exception:
        return []


def install_extension(pkg_name: str):
    """
    Commands Suwayomi to download and install a new extension.
    """
    endpoint = f"extension/install/{pkg_name}"
    # We use requests.post() here instead of requests.get()
    response = requests.post(f"{BASE_URL}/{endpoint}")
    return response.json()


# --- EXTENSION MANAGEMENT (GraphQL) ------------------------------------------
# The REST /extension/* endpoints are deprecated in recent Suwayomi builds, so
# extension management goes through GraphQL, which is stable across versions.

def list_extensions_gql() -> list:
    """
    Return every extension Suwayomi knows about (from the configured repos),
    installed or not. Empty list on error.
    """
    query = """
    query {
      extensions {
        nodes {
          pkgName name lang versionName iconUrl
          isInstalled isObsolete hasUpdate isNsfw repo
        }
      }
    }
    """
    data = graphql(query)
    nodes = (((data.get("data") or {}).get("extensions") or {}).get("nodes")) or []
    return nodes if isinstance(nodes, list) else []


def fetch_extensions_gql() -> dict:
    """
    Refresh the extension catalog from the configured repos. Slow — it pulls the
    repo index over the network — so it gets a generous timeout.
    """
    query = "mutation { fetchExtensions(input: {}) { extensions { pkgName } } }"
    return graphql(query, timeout=60)


def set_extension_install_gql(pkg_name: str, install: bool) -> dict:
    """
    Install (install=True) or uninstall (install=False) an extension by pkgName.
    """
    query = """
    mutation SetInstall($id: String!, $patch: UpdateExtensionPatchInput!) {
      updateExtension(input: {id: $id, patch: $patch}) {
        extension { pkgName isInstalled hasUpdate }
      }
    }
    """
    patch = {"install": True} if install else {"uninstall": True}
    return graphql(query, {"id": pkg_name, "patch": patch})

def get_latest_manga(source_id: str, page: int = 1):
    """Fetches the latest updated manga from a specific source."""
    endpoint = f"source/{source_id}/latest/{page}"
    return safe_fetch(endpoint)

def get_source_filters(source_id: str):
    """
    Fetches the filter blueprint for a specific source.
    """
    endpoint = f"source/{source_id}/filters"
    return safe_fetch(endpoint)







def search_manga_in_source(source_id: str, query: str, page: int = 1):
    """Search for manga in a specific source by text query."""
    url = f"{BASE_URL}/source/{source_id}/search"
    try:
        response = requests.get(
            url,
            params={"pageNum": page, "searchTerm": query},
            timeout=8,
        )
        if "application/json" in response.headers.get("Content-Type", ""):
            return response.json()
        return {"success": False}
    except Exception as e:
        return {"success": False, "error": str(e)}

def search_with_filters(source_id: str, filter_payload: list, page: int = 1):
    """
    Sends a custom search request using a modified filter payload.
    """
    url = f"{BASE_URL}/source/{source_id}/search"
    try:
        # THE FIX: Explicitly passing params forces searchTerm to be "" instead of null
        response = requests.post(url, params={"pageNum": page, "searchTerm": ""}, json=filter_payload)
        
        if "application/json" in response.headers.get("Content-Type", ""):
            return response.json()
        else:
            return {"success": False, "error": "Search returned HTML instead of JSON"}
            
    except Exception as e:
        return {"success": False, "error": str(e)}
    



def search_graphql(source_id: str, graphql_filters: list, page: int = 1):
    """
    Bypasses the REST API and sends a direct GraphQL mutation 
    to fetch manga using filters, just like the official Web UI.
    """
    url = f"{_SUWAYOMI}/api/graphql"
    
    # The exact query you extracted from the Network tab!
    query = """
    fragment MANGA_BASE_FIELDS on MangaType {
      id
      title
      thumbnailUrl
      thumbnailUrlLastFetched
      inLibrary
      initialized
      sourceId
      __typename
    }
    mutation GET_SOURCE_MANGAS_FETCH($input: FetchSourceMangaInput!) {
      fetchSourceManga(input: $input) {
        hasNextPage
        mangas {
          ...MANGA_BASE_FIELDS
          __typename
        }
        __typename
      }
    }
    """
    
    payload = {
        "operationName": "GET_SOURCE_MANGAS_FETCH",
        "query": query,
        "variables": {
            "input": {
                "type": "SEARCH",
                "source": source_id,
                "query": "", # The magical empty string!
                "filters": graphql_filters,
                "page": page
            }
        }
    }
    
    try:
        response = requests.post(url, json=payload)
        return response.json()
    except Exception as e:
        return {"success": False, "error": str(e)}