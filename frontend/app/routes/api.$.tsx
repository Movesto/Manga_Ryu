import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { API } from "../lib/config";

// Proxy route: /api/* → http://127.0.0.1:8000/api/*
// Allows browser-side fetch() calls to reach the backend through the frontend server.
async function proxy(request: Request, params: Record<string, string | undefined>) {
  const path = params["*"] ?? "";

  if (path.includes("..") || /[\x00-\x1f]/.test(path)) {
    return new Response(null, { status: 400 });
  }

  const url = new URL(request.url);
  const target = `${API}/api/${path}${url.search}`;

  const headers = new Headers(request.headers);
  headers.delete("host");

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
