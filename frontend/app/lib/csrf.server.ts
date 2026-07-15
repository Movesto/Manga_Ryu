import { randomBytes, timingSafeEqual } from "crypto";

export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

export function getCsrfToken(request: Request): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function csrfCookieHeader(token: string): string {
  return `csrf_token=${encodeURIComponent(token)}; Path=/; SameSite=Strict; Max-Age=86400; Secure`;
}

export function verifyCsrf(request: Request, submitted: string | null): boolean {
  const cookieToken = getCsrfToken(request);
  if (!cookieToken || !submitted) return false;
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(submitted);
  return a.length === b.length && timingSafeEqual(a, b);
}
