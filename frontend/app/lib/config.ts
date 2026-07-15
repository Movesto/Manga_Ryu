// Server-side upstream URLs. Overridable via env for containerized deploys
// (e.g. API_URL=http://backend:8000, MEDIA_URL=http://suwayomi:4567).
// The typeof guard keeps this module safe in the browser bundle, where only
// imgUrl is actually used.
const env = typeof process !== "undefined" ? process.env : undefined;

export const API   = env?.API_URL   ?? "http://127.0.0.1:8000";
export const MEDIA = env?.MEDIA_URL ?? "http://127.0.0.1:4567"; // server-side only — never sent to browsers

// All browser-facing image URLs go through the /media proxy route.
export const imgUrl = (path: string) => `/media${path}`;

// Forward the real client IP to the backend so per-IP rate limiting keys on
// the user, not on this server. Cloudflare (or any proxy in front) sets
// X-Forwarded-For; uvicorn runs with --proxy-headers and resolves it.
export function clientIpHeaders(request: Request): Record<string, string> {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return ip ? { "X-Forwarded-For": ip } : {};
}
