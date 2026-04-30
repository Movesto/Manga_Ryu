import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  redirect,
  useLoaderData,
  useNavigation,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import Navbar from "./components/Navbar";
import { getUser } from "./lib/auth.server";

export const links: Route.LinksFunction = () => [
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

// Security headers applied to every HTML response
const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options":    "nosniff",
  "X-Frame-Options":           "DENY",
  "Referrer-Policy":           "strict-origin-when-cross-origin",
  "Permissions-Policy":        "camera=(), microphone=(), geolocation=()",
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

export function headers() {
  return SECURITY_HEADERS;
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
  return { user };
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

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const { user } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  const pending = navigation.state !== "idle";
  const pendingPath = navigation.location?.pathname ?? "";
  const isManga    = pending && /^\/manga\/[^/]+$/.test(pendingPath);
  const isChapter  = pending && /^\/manga\/[^/]+\/chapter\//.test(pendingPath);
  const isHome     = pending && pendingPath === "/";

  return (
    <>
      {pending && (
        <div className="fixed top-0 left-0 right-0 z-[200] h-[2px] bg-zinc-800 overflow-hidden">
          <div className="h-full bg-orange-500 progress-bar" />
        </div>
      )}
      <Navbar user={user} />
      {isManga   ? <MangaDetailSkeleton /> :
       isChapter  ? <ChapterSkeleton />     :
       isHome     ? <HomeSkeleton />        :
       <Outlet />}
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
