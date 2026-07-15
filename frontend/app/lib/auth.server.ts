import { API } from "./config";

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
}

interface TokenPair {
  access_token: string;
  refresh_token: string;
}

export interface Session {
  user: AuthUser | null;
  token: string | null;
  /** Set-Cookie values to attach to the response when tokens were refreshed */
  setCookies: string[];
}

function parseCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getAccessToken(request: Request) {
  return parseCookie(request, "access_token");
}

export function getRefreshToken(request: Request) {
  return parseCookie(request, "refresh_token");
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

// Short-TTL /me cache: the root loader plus route loaders would otherwise hit
// the backend once each per navigation just to resolve the same user.
const _ME_TTL_MS = 30_000;
const _ME_MAX = 500;
const _meCache = new Map<string, { user: AuthUser | null; at: number }>();

async function fetchMe(token: string): Promise<AuthUser | null> {
  const hit = _meCache.get(token);
  if (hit && Date.now() - hit.at < _ME_TTL_MS) return hit.user;

  let user: AuthUser | null = null;
  try {
    const res = await fetch(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) user = await res.json();
  } catch {
    return null; // network error: don't cache
  }

  if (_meCache.size >= _ME_MAX) {
    const oldest = _meCache.keys().next().value;
    if (oldest !== undefined) _meCache.delete(oldest);
  }
  _meCache.set(token, { user, at: Date.now() });
  return user;
}

// The backend rotates (revokes) the refresh token on every use, so parallel
// loaders handling the same browser request must share a single refresh call.
// The memo is kept briefly after settling because the client keeps sending the
// old cookie until a Set-Cookie response lands.
const _inflightRefresh = new Map<string, Promise<TokenPair | null>>();

function refreshTokens(refreshToken: string): Promise<TokenPair | null> {
  let pending = _inflightRefresh.get(refreshToken);
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetch(`${API}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!res.ok) return null;
        return (await res.json()) as TokenPair;
      } catch {
        return null;
      }
    })();
    _inflightRefresh.set(refreshToken, pending);
    pending.finally(() => setTimeout(() => _inflightRefresh.delete(refreshToken), 30_000));
  }
  return pending;
}

/**
 * Resolve the current user, transparently refreshing an expired access token.
 * Loaders must attach `setCookies` to their response (see sessionHeaders) so
 * the rotated tokens reach the browser.
 */
export async function getSession(request: Request): Promise<Session> {
  const access = getAccessToken(request);
  if (access) {
    const user = await fetchMe(access);
    if (user) return { user, token: access, setCookies: [] };
  }

  const refresh = getRefreshToken(request);
  if (!refresh) return { user: null, token: null, setCookies: [] };

  const pair = await refreshTokens(refresh);
  if (!pair) return { user: null, token: null, setCookies: [] };

  const user = await fetchMe(pair.access_token);
  if (!user) return { user: null, token: null, setCookies: [] };

  return {
    user,
    token: pair.access_token,
    setCookies: authCookieHeaders(pair.access_token, pair.refresh_token).map(([, v]) => v),
  };
}

/** Headers carrying refreshed auth cookies, or undefined if nothing to set. */
export function sessionHeaders(session: Session): Headers | undefined {
  if (session.setCookies.length === 0) return undefined;
  const headers = new Headers();
  for (const value of session.setCookies) headers.append("Set-Cookie", value);
  return headers;
}

export async function getUser(request: Request): Promise<AuthUser | null> {
  return (await getSession(request)).user;
}
