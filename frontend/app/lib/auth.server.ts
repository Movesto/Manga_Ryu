import { API } from "./config";

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
}

function parseCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getAccessToken(request: Request) {
  return parseCookie(request, "access_token");
}

export function authCookieHeaders(access: string, refresh: string): [string, string][] {
  return [
    ["Set-Cookie", `access_token=${encodeURIComponent(access)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`],
    ["Set-Cookie", `refresh_token=${encodeURIComponent(refresh)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure`],
  ];
}

export function clearCookieHeaders(): [string, string][] {
  return [
    ["Set-Cookie", `access_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`],
    ["Set-Cookie", `refresh_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`],
  ];
}

export async function getUser(request: Request): Promise<AuthUser | null> {
  const token = parseCookie(request, "access_token");
  if (!token) return null;
  try {
    const res = await fetch(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
