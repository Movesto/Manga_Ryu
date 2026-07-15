import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { LoaderFunctionArgs } from "react-router";
import { MEDIA } from "../lib/config";

const CACHE_DIR = "/tmp/manga-media-cache";
const CACHE_MAX_BYTES = 512 * 1024 * 1024; // 512 MB disk-cache cap
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}

// Restrict what the proxy will serve — Suwayomi media is always images.
const ALLOWED_CT = /^image\//;

// Evict oldest cache files when the cap is exceeded. Runs off the request
// path; failures are ignored (the cache is best-effort).
let _pruning = false;
async function pruneCache() {
  if (_pruning) return;
  _pruning = true;
  try {
    const names = await fsp.readdir(CACHE_DIR);
    const files: { p: string; size: number; mtime: number }[] = [];
    for (const name of names) {
      try {
        const p = path.join(CACHE_DIR, name);
        const st = await fsp.stat(p);
        files.push({ p, size: st.size, mtime: st.mtimeMs });
      } catch { /* removed concurrently */ }
    }
    let total = files.reduce((s, f) => s + f.size, 0);
    if (total <= CACHE_MAX_BYTES) return;
    files.sort((a, b) => a.mtime - b.mtime);
    for (const f of files) {
      if (total <= CACHE_MAX_BYTES * 0.9) break;
      try {
        await fsp.unlink(f.p);
        total -= f.size;
      } catch { /* already gone */ }
    }
  } catch { /* best-effort */ } finally {
    _pruning = false;
  }
}

// Proxy route: /media/* → the local Suwayomi server.
// Browsers can't reach Suwayomi directly, so all media is proxied here.
// Responses are cached to disk so thumbnails survive Suwayomi restarts.
export async function loader({ params }: LoaderFunctionArgs) {
  const urlPath = params["*"] ?? "";

  if (urlPath.includes("..") || urlPath.includes("//") || /[\x00-\x1f]/.test(urlPath)) {
    return new Response(null, { status: 400 });
  }

  const cacheKey = crypto.createHash("md5").update(urlPath).digest("hex");
  const cachePath = path.join(CACHE_DIR, cacheKey);
  const ctPath    = cachePath + ".ct";

  try {
    const [buf, ct] = await Promise.all([
      fsp.readFile(cachePath),
      fsp.readFile(ctPath, "utf8").catch(() => "image/jpeg"),
    ]);
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type":   ct,
        "Content-Length": String(buf.byteLength),
        "Cache-Control":  "public, max-age=86400, immutable",
      },
    });
  } catch {
    // cache miss — fall through to upstream
  }

  const upstream = await fetch(`${MEDIA}/${urlPath}`).catch(() => null);

  if (!upstream?.ok || !upstream.body) {
    return new Response(null, { status: 404 });
  }

  const ct = upstream.headers.get("Content-Type") ?? "image/jpeg";
  if (!ALLOWED_CT.test(ct)) {
    return new Response(null, { status: 404 });
  }

  const body = await upstream.arrayBuffer();
  if (body.byteLength === 0) {
    return new Response(null, { status: 404 });
  }

  // Persist to disk cache without blocking the response
  setImmediate(async () => {
    try {
      await fsp.writeFile(cachePath, Buffer.from(body));
      await fsp.writeFile(ctPath, ct);
    } catch { /* best-effort */ }
    void pruneCache();
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type":   ct,
      "Content-Length": String(body.byteLength),
      "Cache-Control":  "public, max-age=86400, immutable",
    },
  });
}
