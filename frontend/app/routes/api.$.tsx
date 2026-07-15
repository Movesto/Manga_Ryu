import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { API } from "../lib/config";
import { getAccessToken } from "../lib/auth.server";
import { verifyCsrf } from "../lib/csrf.server";

// Proxy route: /api/* → backend /api/*
// Allows browser-side fetch() calls to reach the backend through the frontend
// server. The session cookie never leaves this server: it is translated into
// an Authorization header, and state-changing requests must pass a same-origin
// check plus the double-submit CSRF token (X-CSRF-Token header).

const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST"]);

function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-CORS request (no Origin header)
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function proxy(request: Request, params: Record<string, string | undefined>) {
  const path = params["*"] ?? "";

  if (path.includes("..") || /[\x00-\x1f]/.test(path)) {
    return new Response(null, { status: 400 });
  }
  if (!ALLOWED_METHODS.has(request.method)) {
    return new Response(null, { status: 405 });
  }
  // Auth flows go through dedicated server actions, never the browser proxy
  if (path === "auth" || path.startsWith("auth/")) {
    return new Response(null, { status: 404 });
  }

  if (request.method === "POST") {
    if (!sameOrigin(request)) {
      return new Response(null, { status: 403 });
    }
    if (!verifyCsrf(request, request.headers.get("x-csrf-token"))) {
      return new Response("Invalid CSRF token", { status: 403 });
    }
  }

  const url = new URL(request.url);
  const target = `${API}/api/${path}${url.search}`;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("cookie"); // session cookies stay on this server
  headers.delete("x-csrf-token");
  const token = getAccessToken(request);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const upstream = await fetch(target, {
    method:  request.method,
    headers,
    body:    request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
    // @ts-ignore — Node 18+ fetch duplex required for streaming body
    duplex: "half",
  }).catch(() => null);

  if (!upstream) {
    return new Response("Backend unavailable", { status: 502 });
  }

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("transfer-encoding");

  return new Response(upstream.body, {
    status:  upstream.status,
    headers: responseHeaders,
  });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  return proxy(request, params);
}

export async function action({ request, params }: ActionFunctionArgs) {
  return proxy(request, params);
}
