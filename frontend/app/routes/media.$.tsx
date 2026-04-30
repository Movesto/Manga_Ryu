import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { LoaderFunctionArgs } from "react-router";
import { MEDIA } from "../lib/config";

const CACHE_DIR = "/tmp/manga-media-cache";
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}

// Proxy route: /media/* → http://127.0.0.1:4567/*
// Browsers can't reach the local Suwayomi server, so all media is proxied here.
// Responses are cached to disk so thumbnails survive Suwayomi restarts.
export async function loader({ params }: LoaderFunctionArgs) {
  const urlPath = params["*"] ?? "";

  if (urlPath.includes("..") || urlPath.includes("//") || /[\x00-\x1f]/.test(urlPath)) {
    return new Response(null, { status: 400 });
  }

  const cacheKey = crypto.createHash("md5").update(urlPath).digest("hex");
  const cachePath = path.join(CACHE_DIR, cacheKey);
  const ctPath    = cachePath + ".ct";

  if (fs.existsSync(cachePath)) {
    const ct   = fs.existsSync(ctPath) ? fs.readFileSync(ctPath, "utf8") : "image/jpeg";
    const size = fs.statSync(cachePath).size;
    return new Response(fs.readFileSync(cachePath), {
      status: 200,
      headers: {
        "Content-Type":   ct,
        "Content-Length": String(size),
        "Cache-Control":  "public, max-age=86400, immutable",
      },
    });
  }

  const upstream = await fetch(`${MEDIA}/${urlPath}`).catch(() => null);

  if (!upstream?.ok || !upstream.body) {
    return new Response(null, { status: 404 });
  }

  const body = await upstream.arrayBuffer();
  if (body.byteLength === 0) {
    return new Response(null, { status: 404 });
  }

  const ct = upstream.headers.get("Content-Type") ?? "image/jpeg";

  // Persist to disk cache without blocking the response
  setImmediate(() => {
    try {
      fs.writeFileSync(cachePath, Buffer.from(body));
      fs.writeFileSync(ctPath, ct);
    } catch {}
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
