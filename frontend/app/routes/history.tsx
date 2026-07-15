import { Link, useLoaderData, useFetcher, redirect, useRouteLoaderData } from "react-router";
import { data } from "react-router";
import { getSession, sessionHeaders } from "../lib/auth.server";
import { verifyCsrf } from "../lib/csrf.server";
import { API, imgUrl } from "../lib/config";
import { relativeTime, chNum } from "../lib/utils";

export async function loader({ request }: { request: Request }) {
  const session = await getSession(request);
  const { user, token } = session;
  if (!user) throw redirect("/signin?next=/history");

  const res   = await fetch(`${API}/api/history`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = res.ok ? await res.json() : { history: [] };
  return data(
    { history: payload.history ?? [], user },
    { headers: sessionHeaders(session) },
  );
}

export async function action({ request }: { request: Request }) {
  const { user, token } = await getSession(request);
  if (!user) return { ok: false };
  const form  = await request.formData();

  const submitted = form.get("csrf_token") as string | null;
  if (!verifyCsrf(request, submitted)) {
    throw new Response("Invalid CSRF token", { status: 403 });
  }

  const mangaId = form.get("manga_id");
  if (!mangaId) return { ok: false };

  await fetch(`${API}/api/history/${mangaId}`, {
    method:  "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return { ok: true };
}

export function meta() {
  return [{ title: "Reading History — Manga Ryu" }];
}

export default function History() {
  const { history } = useLoaderData<typeof loader>();
  const { csrf } = useRouteLoaderData("root") as { csrf: string };
  const fetcher = useFetcher();

  const optimisticRemoved = new Set<number>();
  if (fetcher.formData) {
    const id = Number(fetcher.formData.get("manga_id"));
    if (id) optimisticRemoved.add(id);
  }

  const visible = history.filter((h: any) => !optimisticRemoved.has(h.mangaId));

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Reading History</h1>
            <p className="text-zinc-500 text-sm mt-1">
              {visible.length} manga read
            </p>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-zinc-600">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-4">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
            <p className="text-sm font-medium">No reading history yet</p>
            <p className="text-xs mt-1">Start reading manga and your history will appear here.</p>
            <Link
              to="/browse"
              className="mt-5 px-4 py-2 bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              Browse Manga
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map((h: any) => (
              <div
                key={h.mangaId}
                className="group flex items-center gap-3 sm:gap-4 bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800/60 hover:border-zinc-700 rounded-xl px-3 py-3 transition-all"
              >
                {/* Cover */}
                <Link to={`/manga/${h.mangaId}`} className="flex-shrink-0">
                  <img
                    src={imgUrl(h.mangaThumbnail)}
                    alt={h.mangaTitle}
                    className="w-12 h-[4.5rem] object-cover rounded-lg bg-zinc-800"
                  />
                </Link>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <Link
                    to={`/manga/${h.mangaId}`}
                    className="text-sm font-semibold text-white group-hover:text-orange-400 transition-colors line-clamp-1"
                  >
                    {h.mangaTitle}
                  </Link>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Last read: Ch. {h.lastChapterNumber != null ? chNum(h.lastChapterNumber) : "?"}
                  </p>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    {relativeTime(h.readAt ? new Date(h.readAt).getTime() : 0)}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Link
                    to={`/manga/${h.mangaId}/chapter/${h.lastChapterId}`}
                    className="text-xs px-3 py-1.5 bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 rounded-lg border border-orange-500/20 transition-colors font-medium whitespace-nowrap"
                  >
                    Continue
                  </Link>
                  <fetcher.Form method="post">
                    <input type="hidden" name="manga_id" value={h.mangaId} />
                    <input type="hidden" name="csrf_token" value={csrf} />
                    <button
                      type="submit"
                      title="Remove from history"
                      className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </fetcher.Form>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
