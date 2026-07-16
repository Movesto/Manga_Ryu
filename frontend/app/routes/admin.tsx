import { useState, useEffect, useRef } from "react";
import { redirect, useLoaderData, useFetcher, Link, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/admin";
import { data } from "react-router";
import { getSession, sessionHeaders } from "../lib/auth.server";
import { verifyCsrf } from "../lib/csrf.server";
import { API, imgUrl } from "../lib/config";
import { SearchIcon, TrashIcon, PlusIcon, ShieldIcon } from "../components/icons";

// ── loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSession(request);
  const { user } = session;
  if (!user) throw redirect("/signin?next=/admin");
  if (!user.is_admin) throw redirect("/");

  const res  = await fetch(`${API}/api/editors-choice`);
  const picksData = await res.json().catch(() => ({ mangaList: [] }));
  return data(
    { user, picks: (picksData.mangaList ?? []) as any[] },
    { headers: sessionHeaders(session) },
  );
}

// ── action ────────────────────────────────────────────────────────────────────

export async function action({ request }: Route.ActionArgs) {
  const form    = await request.formData();
  const submitted = form.get("csrf_token") as string | null;
  if (!verifyCsrf(request, submitted)) {
    throw new Response("Invalid CSRF token", { status: 403 });
  }

  const { token } = await getSession(request);
  if (!token) return { error: "Not authenticated" };

  const intent  = form.get("intent") as string;
  const mangaId = form.get("manga_id") as string;

  if (intent === "add") {
    await fetch(`${API}/api/editors-choice/${mangaId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    return { ok: true };
  }

  if (intent === "remove") {
    await fetch(`${API}/api/editors-choice/${mangaId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    return { ok: true };
  }

  return { error: "Unknown intent" };
}

// ── manga search box ──────────────────────────────────────────────────────────

function MangaSearchBox({
  pickedIds,
  onAdd,
}: {
  pickedIds: Set<number>;
  onAdd: (manga: any) => void;
}) {
  const [q, setQ]             = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef              = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res  = await fetch(`/search?q=${encodeURIComponent(q.trim())}`);
        const data = await res.json();
        setResults(data.mangaList ?? []);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(timerRef.current);
  }, [q]);

  return (
    <div className="relative">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none">
          <SearchIcon />
        </span>
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search manga to add… (min 2 chars)"
          className="w-full bg-zinc-900 border border-zinc-700 focus:border-orange-500 rounded-xl pl-9 pr-4 py-2.5 text-white placeholder-zinc-500 text-sm outline-none transition-colors"
        />
      </div>

      {q.trim().length >= 2 && (
        <div className="absolute z-20 top-full mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto">
          {loading ? (
            <div className="py-6 text-center">
              <div className="inline-block w-4 h-4 border-2 border-zinc-700 border-t-orange-500 rounded-full animate-spin" />
            </div>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">No results</p>
          ) : (
            results.map((m: any) => {
              const already = pickedIds.has(m.id);
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800/50 last:border-0"
                >
                  <img
                    src={imgUrl(m.thumbnailUrl)}
                    alt={m.title}
                    className="w-8 h-12 object-cover rounded flex-shrink-0 bg-zinc-800"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{m.title}</p>
                    <p className="text-zinc-500 text-xs truncate">{m.sourceName}</p>
                  </div>
                  <button
                    disabled={already}
                    onClick={() => { onAdd(m); setQ(""); setResults([]); }}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex-shrink-0 ${
                      already
                        ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                        : "bg-orange-500 hover:bg-orange-400 text-white"
                    }`}
                  >
                    <PlusIcon />
                    {already ? "Added" : "Add"}
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user, picks: initialPicks } = useLoaderData<typeof loader>();
  const { csrf } = useRouteLoaderData("root") as { csrf: string };
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();

  const submitting     = fetcher.state !== "idle";
  const pendingIntent  = submitting ? fetcher.formData?.get("intent")  as string : null;
  const pendingMangaId = submitting ? Number(fetcher.formData?.get("manga_id")) : null;

  const picks: any[] = (() => {
    if (!submitting) return initialPicks;
    if (pendingIntent === "remove") return initialPicks.filter((m: any) => m.id !== pendingMangaId);
    return initialPicks;
  })();

  const pickedIds = new Set<number>(picks.map((m: any) => m.id));

  function handleAdd(manga: any) {
    fetcher.submit(
      { intent: "add", manga_id: manga.id, csrf_token: csrf },
      { method: "post" }
    );
  }

  function handleRemove(mangaId: number) {
    fetcher.submit(
      { intent: "remove", manga_id: mangaId, csrf_token: csrf },
      { method: "post" }
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">

        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <span className="text-orange-400"><ShieldIcon /></span>
          <h1 className="text-2xl font-bold text-white">Admin Panel</h1>
        </div>
        <p className="text-zinc-500 text-sm mb-8">
          Signed in as <span className="text-orange-400 font-medium">{user.username}</span>
        </p>

        {/* Section: Extensions */}
        <Link
          to="/admin/extensions"
          className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 hover:border-orange-500/50 rounded-2xl p-6 mb-6 transition-colors group"
        >
          <span className="text-orange-400 text-lg">🧩</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-white">Extensions</h2>
            <p className="text-zinc-500 text-sm">
              Install source extensions and sync their manga into the catalog.
            </p>
          </div>
          <span className="text-zinc-600 group-hover:text-orange-400 transition-colors">→</span>
        </Link>

        {/* Section: Editor's Choice */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-yellow-400 text-lg">⭐</span>
            <h2 className="text-lg font-bold text-white">Editor's Choice</h2>
            <span className="ml-auto text-xs text-zinc-600">{picks.length} / 12</span>
          </div>
          <p className="text-zinc-500 text-sm mb-6">
            Curate up to 12 manga shown in the Editor's Pick section on the home page.
          </p>

          {/* Search to add */}
          <div className="mb-6">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Add manga</p>
            <MangaSearchBox pickedIds={pickedIds} onAdd={handleAdd} />
          </div>

          {/* Current picks */}
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">
              Current picks
            </p>

            {picks.length === 0 ? (
              <div className="py-12 text-center border border-dashed border-zinc-700 rounded-xl">
                <p className="text-zinc-500 text-sm">No picks yet</p>
                <p className="text-zinc-600 text-xs mt-1">Search above to add manga to the home page.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {picks.map((m: any) => (
                  <div key={m.id} className="group relative bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden">
                    <Link to={`/manga/${m.id}`} className="block">
                      <div className="relative aspect-[2/3] bg-zinc-700 overflow-hidden">
                        <img
                          src={imgUrl(m.thumbnailUrl)}
                          alt={m.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/80 via-transparent to-transparent" />
                      </div>
                      <div className="p-3">
                        <p className="text-white text-sm font-medium line-clamp-2 leading-snug">{m.title}</p>
                        <p className="text-zinc-500 text-xs mt-1 truncate">{m.sourceName}</p>
                      </div>
                    </Link>

                    <button
                      onClick={() => handleRemove(m.id)}
                      disabled={submitting && pendingMangaId === m.id}
                      className="absolute top-2 right-2 p-1.5 bg-zinc-900/80 hover:bg-red-500/20 hover:text-red-400 text-zinc-400 rounded-lg transition-colors opacity-0 group-hover:opacity-100 border border-zinc-700 disabled:opacity-50"
                      title="Remove"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="pt-2">
          <Link
            to="/"
            className="text-sm text-zinc-500 hover:text-white transition-colors"
          >
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
