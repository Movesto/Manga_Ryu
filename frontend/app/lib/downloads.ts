// Client-side offline downloads for the PWA. Chapter page images live in the
// Cache Storage bucket DL_CACHE (permanent — never auto-trimmed, only user
// deletes); chapter/manga metadata lives in IndexedDB DB_NAME. The offline
// reader (public/downloads.html) reads the SAME two stores, so anything saved
// here is readable with no connection.
//
// Browser-only: call these from event handlers / effects, never during SSR.

export const DB_NAME = "ryu-dl";
export const DB_VERSION = 1;
export const STORE = "chapters";
export const DL_CACHE = "ryu-dl-images";

export interface DownloadedChapter {
  id: string;            // chapterId
  mangaId: string;
  mangaTitle: string;
  mangaThumb: string;    // /media/... url
  chapterName: string;
  chapterNumber: number;
  pages: string[];       // /media/... urls, in order
  pageCount: number;
  downloadedAt: number;
  bytes: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("mangaId", "mangaId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function isDownloaded(chapterId: string): Promise<boolean> {
  return tx<DownloadedChapter | undefined>("readonly", (s) => s.get(chapterId))
    .then((r) => !!r)
    .catch(() => false);
}

export function listDownloads(): Promise<DownloadedChapter[]> {
  return tx<DownloadedChapter[]>("readonly", (s) => s.getAll()).catch(() => []);
}

/**
 * Download a chapter for offline reading. Fetches every page image into the
 * permanent DL_CACHE and records metadata in IndexedDB. `onProgress(done,total)`
 * reports progress. Idempotent-ish: re-downloading overwrites the record.
 */
export async function downloadChapter(
  meta: Omit<DownloadedChapter, "downloadedAt" | "bytes" | "pageCount">,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const cache = await caches.open(DL_CACHE);
  const urls = [meta.mangaThumb, ...meta.pages].filter(Boolean);
  let bytes = 0;
  let done = 0;
  const total = meta.pages.length;

  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "reload" });
      if (res.ok) {
        const buf = await res.clone().arrayBuffer();
        bytes += buf.byteLength;
        await cache.put(url, res);
      }
    } catch {
      /* skip a failed page; better a partial download than none */
    }
    if (url !== meta.mangaThumb) {
      done++;
      onProgress?.(done, total);
    }
  }

  const record: DownloadedChapter = {
    ...meta,
    pageCount: total,
    bytes,
    downloadedAt: Date.now(),
  };
  await tx("readwrite", (s) => s.put(record));
}

export async function deleteChapter(chapterId: string): Promise<void> {
  const rec = await tx<DownloadedChapter | undefined>("readonly", (s) => s.get(chapterId));
  if (rec) {
    const cache = await caches.open(DL_CACHE);
    // Only delete images not referenced by another downloaded chapter.
    const others = (await listDownloads()).filter((c) => c.id !== chapterId);
    const stillUsed = new Set(others.flatMap((c) => [c.mangaThumb, ...c.pages]));
    for (const url of [...rec.pages, rec.mangaThumb]) {
      if (!stillUsed.has(url)) await cache.delete(url);
    }
  }
  await tx("readwrite", (s) => s.delete(chapterId));
}

export async function deleteManga(mangaId: string): Promise<void> {
  const all = await listDownloads();
  for (const c of all.filter((c) => c.mangaId === mangaId)) {
    await deleteChapter(c.id);
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number }> {
  if (navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  }
  return { usage: 0, quota: 0 };
}
