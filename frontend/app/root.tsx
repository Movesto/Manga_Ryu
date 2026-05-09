import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  redirect,
  useLoaderData,
  useMatches,
  useNavigation,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import Navbar from "./components/Navbar";
import { MangaRyuLogo, SITE_NAME } from "./components/Logo";
import { getUser } from "./lib/auth.server";
import { generateCsrfToken, getCsrfToken, csrfCookieHeader } from "./lib/csrf.server";
import { data } from "react-router";

export const links: Route.LinksFunction = () => [
  {
    rel: "icon",
    type: "image/svg+xml",
    href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28' fill='none'%3E%3Cpath d='M14 2C10.5 2 7.5 4.5 7 8.5C6.5 12 8.5 14.5 10 17.5C11 19.5 10.5 22.5 9 25C11.5 23.5 14.5 21 15.5 18C16 20.5 15.5 23.5 13.5 26C16 24.5 19 22 20 18.5C21 15.5 20.5 11.5 18.5 9C17.5 7 17.5 4.5 19 2.5C17.5 2.2 15.7 2 14 2Z' fill='%23f97316'/%3E%3Cpath d='M13.5 7.5C12.5 10 12.5 13 13.5 15.5C14 17 14 19 13 21.5C15 19.5 16 17 15.5 14C15 11.5 14.2 9 13.5 7.5Z' fill='%23fbbf24'/%3E%3Cpath d='M18.5 3.5C21 1.5 24 2.5 23 5.5C22.5 7.5 19.5 6.5 18.5 3.5Z' fill='%23fb923c'/%3E%3Cpath d='M7 11C4.5 9.5 3 12 5 13.5C6 14.5 8 13.5 7 11Z' fill='%23fb923c'/%3E%3C/svg%3E",
  },
  { rel: "manifest", href: "/manifest.json" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function meta() {
  return [
    { title: SITE_NAME },
    { name: "description", content: "Read manga, manhwa and manhua online — powered by Manga Ryu." },
    { property: "og:title", content: SITE_NAME },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:description", content: "Read manga, manhwa and manhua online." },
    { name: "theme-color", content: "#f97316" },
    { name: "mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
    { name: "apple-mobile-web-app-title", content: SITE_NAME },
  ];
}

// Security headers applied to every HTML response
const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options":    "nosniff",
  "X-Frame-Options":           "DENY",
  "Referrer-Policy":           "strict-origin-when-cross-origin",
  "Permissions-Policy":        "camera=(), microphone=(), geolocation=()",
  // TODO: replace 'unsafe-inline' in script-src with per-request nonces.
  // Requires creating app/entry.server.tsx, generating a nonce there,
  // threading it through loadContext → root loader → headers(), and
  // passing it to <Scripts nonce={nonce} />.  Style 'unsafe-inline' is
  // kept because React's style={{...}} props require it.
  "Content-Security-Policy":
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: blob: https:; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none'; " +
    "object-src 'none';",
};

export function headers({ loaderHeaders }: { loaderHeaders: Headers }) {
  const result: Record<string, string> = { ...SECURITY_HEADERS };
  const setCookie = loaderHeaders.get("Set-Cookie");
  if (setCookie) result["Set-Cookie"] = setCookie;
  return result;
}

export async function loader({ request }: Route.LoaderArgs) {
  // Redirect HTTP → HTTPS (Cloudflare sets X-Forwarded-Proto on the tunnel)
  if (request.headers.get("x-forwarded-proto") === "http") {
    throw redirect(request.url.replace(/^http:/, "https:"), {
      status: 301,
      headers: { "Strict-Transport-Security": SECURITY_HEADERS["Strict-Transport-Security"] },
    });
  }

  const user = await getUser(request);
  const csrf = getCsrfToken(request) ?? generateCsrfToken();
  return data({ user, csrf }, { headers: { "Set-Cookie": csrfCookieHeader(csrf) } });
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// ── Skeleton primitives ───────────────────────────────────────────────────────

function Sk({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton-shimmer rounded ${className ?? ""}`} style={style} />;
}

function MangaDetailSkeleton() {
  return (
    <div className="min-h-screen bg-zinc-950">
      <section className="relative pb-10 pt-4">
        <div className="absolute inset-0 bg-zinc-900/60" />
        <div className="relative z-10 max-w-5xl mx-auto px-4">
          <Sk className="w-16 h-4 mb-6" />
          <div className="flex flex-col sm:flex-row gap-6 sm:gap-8">
            <div className="flex-shrink-0 mx-auto sm:mx-0">
              <Sk className="w-36 sm:w-48 md:w-56 rounded-2xl" style={{ aspectRatio: "2/3" }} />
            </div>
            <div className="flex flex-col gap-4 flex-1 pt-2">
              <Sk className="h-7 w-4/5" />
              <Sk className="h-4 w-1/3" />
              <div className="flex gap-2 flex-wrap">
                <Sk className="h-6 w-20 rounded-full" />
                <Sk className="h-6 w-28 rounded-full" />
                <Sk className="h-6 w-24 rounded-full" />
              </div>
              <div className="flex gap-2 flex-wrap mt-1">
                <Sk className="h-6 w-16 rounded-full" />
                <Sk className="h-6 w-20 rounded-full" />
                <Sk className="h-6 w-14 rounded-full" />
              </div>
              <div className="flex gap-3 mt-1">
                <Sk className="h-10 w-36 rounded-xl" />
                <Sk className="h-10 w-36 rounded-xl" />
                <Sk className="h-10 w-28 rounded-xl" />
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="max-w-5xl mx-auto px-4 py-6 border-t border-zinc-800/60">
        <Sk className="h-5 w-28 mb-5" />
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 py-3">
            <Sk className="w-2 h-2 rounded-full flex-shrink-0" />
            <Sk className="h-4 flex-1" />
            <Sk className="h-4 w-14 flex-shrink-0" />
          </div>
        ))}
      </section>
    </div>
  );
}

function ChapterSkeleton() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center gap-1 pt-0">
      <div className="w-full h-12 bg-zinc-900 border-b border-zinc-800 flex items-center px-4 gap-4">
        <Sk className="h-4 w-20" />
        <Sk className="h-4 flex-1 max-w-xs mx-auto" />
        <Sk className="h-4 w-20" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <Sk key={i} className="w-full max-w-2xl" style={{ height: "680px" }} />
      ))}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Hero skeleton */}
      <Sk className="w-full rounded-none" style={{ height: "300px" }} />
      {/* Grid skeleton */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <Sk className="h-5 w-32 mb-5" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Sk className="w-full rounded-lg" style={{ aspectRatio: "2/3" }} />
              <Sk className="h-3 w-full" />
              <Sk className="h-3 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-zinc-800/60 mt-16 py-8 bg-zinc-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MangaRyuLogo size={20} />
          <span className="text-zinc-400 text-sm font-semibold">{SITE_NAME}</span>
        </div>
        <p className="text-zinc-600 text-xs text-center sm:text-right">
          © {new Date().getFullYear()} mangaryu.org &mdash; Read manga, manhwa &amp; manhua online
        </p>
      </div>
    </footer>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const { user, csrf } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const matches = useMatches();

  const pending = navigation.state !== "idle";
  const pendingPath = navigation.location?.pathname ?? "";
  const isManga    = pending && /^\/manga\/[^/]+$/.test(pendingPath);
  const isChapter  = pending && /^\/manga\/[^/]+\/chapter\//.test(pendingPath);
  const isHome     = pending && pendingPath === "/";

  const readingMode = matches.some(m =>
    typeof m.id === "string" && m.id.includes("chapter")
  );

  return (
    <>
      {pending && (
        <div className="fixed top-0 left-0 right-0 z-[200] h-[2px] bg-zinc-800 overflow-hidden">
          <div className="h-full bg-orange-500 progress-bar" />
        </div>
      )}
      <Navbar user={user} csrf={csrf} readingMode={readingMode} />
      <div className="flex flex-col min-h-screen">
        {isManga   ? <MangaDetailSkeleton /> :
         isChapter  ? <ChapterSkeleton />     :
         isHome     ? <HomeSkeleton />        :
         <Outlet />}
        {!isChapter && !readingMode && <Footer />}
      </div>
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto text-white">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
