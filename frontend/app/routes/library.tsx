import { redirect, useLoaderData, useFetcher, Link } from "react-router";
import type { Route } from "./+types/library";
import { getUser, getAccessToken } from "../lib/auth.server";
import { API, imgUrl } from "../lib/config";
import { TrashIcon, BookmarkIcon } from "../components/icons";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  if (!user) throw redirect("/signin?next=/library");

  const token = getAccessToken(request)!;
  const res = await fetch(`${API}/api/bookmarks`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);

  const bookmarks = res?.ok ? await res.json() : [];
  return { user, bookmarks };
}

// ── bookmark card ─────────────────────────────────────────────────────────────

function BookmarkCard({ manga, onRemove }: { manga: any; onRemove: () => void }) {
  const statusColor: Record<string, string> = {
    ONGOING:   "text-green-400 bg-green-500/10",
    COMPLETED: "text-blue-400 bg-blue-500/10",
    HIATUS:    "text-yellow-400 bg-yellow-500/10",
    CANCELLED: "text-red-400 bg-red-500/10",
  };
  const statusLabel: Record<string, string> = {
    ONGOING: "Ongoing", COMPLETED: "Completed",
    HIATUS: "Hiatus", CANCELLED: "Cancelled",
  };
  const status = manga.status?.toUpperCase() ?? "ONGOING";

  return (
    <div className="group relative bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-700 transition-colors">
      <Link to={`/manga/${manga.id}`} className="block">
        <div className="relative aspect-[2/3] overflow-hidden bg-zinc-800">
          <img
            src={imgUrl(manga.thumbnailUrl)}
            alt={manga.title}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/90 via-transparent to-transparent" />
          <span className={`absolute top-2 left-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${statusColor[status] ?? "text-zinc-400 bg-zinc-700"}`}>
            {statusLabel[status] ?? status}
          </span>
        </div>
        <div className="p-3">
          <p className="text-white text-sm font-semibold leading-snug line-clamp-2 group-hover:text-orange-400 transition-colors">
            {manga.title}
          </p>
          {manga.sourceName && (
            <p className="text-zinc-500 text-xs mt-1 truncate">{manga.sourceName}</p>
          )}
          {manga.chapterCount > 0 && (
            <p className="text-zinc-600 text-xs mt-0.5">{manga.chapterCount} chapters</p>
          )}
        </div>
      </Link>

      {/* Remove button */}
      <button
        onClick={e => { e.preventDefault(); onRemove(); }}
        className="absolute top-2 right-2 p-1.5 bg-zinc-900/80 hover:bg-red-500/20 hover:text-red-400 text-zinc-400 rounded-lg transition-colors opacity-0 group-hover:opacity-100 border border-zinc-700"
        title="Remove bookmark"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function Library() {
  const { user, bookmarks: initial } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const removing = fetcher.state !== "idle" ? fetcher.formData?.get("manga_id") : null;
  const bookmarks = (initial as any[]).filter(m => String(m.id) !== String(removing));

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

        {/* Header */}
        <div className="flex items-end gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">My Bookmarks</h1>
            <p className="text-zinc-500 text-sm mt-1">
              {bookmarks.length === 0
                ? "No bookmarks yet"
                : `${bookmarks.length} saved manga`}
            </p>
          </div>
        </div>

        {/* Empty state */}
        {bookmarks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-zinc-700 mb-4">
              <BookmarkIcon size={56} />
            </div>
            <p className="text-zinc-400 font-medium">No bookmarks yet</p>
            <p className="text-zinc-600 text-sm mt-1">
              Browse manga and hit the Bookmark button to save them here.
            </p>
            <Link
              to="/browse"
              className="mt-6 inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors"
            >
              Browse Manga
            </Link>
          </div>
        )}

        {/* Grid */}
        {bookmarks.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
            {bookmarks.map((manga: any) => (
              <BookmarkCard
                key={manga.id}
                manga={manga}
                onRemove={() => {
                  fetcher.submit(
                    { manga_id: manga.id, intent: "remove" },
                    { method: "post", action: "/bookmark" }
                  );
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
