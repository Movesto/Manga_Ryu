import { useState, useCallback } from "react";
import { useLoaderData, Link, useNavigate } from "react-router";
import { API, imgUrl } from "../lib/config";
import { SearchIcon, XIcon, ChevronIcon } from "../components/icons";

export async function loader({ request }: { request: Request }) {
  const url    = new URL(request.url);
  const q      = url.searchParams.get("q")      ?? "";
  const status = url.searchParams.get("status") ?? "";
  const type   = url.searchParams.get("type")   ?? "";
  const genre  = url.searchParams.get("genre")  ?? "";
  const page   = parseInt(url.searchParams.get("page") ?? "1", 10);

  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (status)   params.set("status", status);
  if (type)     params.set("type",   type);
  if (genre)    params.set("genre",  genre);
  params.set("page",      String(page));
  params.set("page_size", "48");

  const res  = await fetch(`${API}/api/browse?${params}`);
  const data = await res.json();

  return {
    mangaList:  data.mangaList  ?? [],
    total:      data.total      ?? 0,
    page:       data.page       ?? page,
    totalPages: data.totalPages ?? 1,
    query: q, status, type, genre,
  };
}

// ── constants ─────────────────────────────────────────────────────────────────

const GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror",
  "Mystery", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural",
  "Thriller", "Psychological", "Historical", "School Life", "Martial Arts",
  "Isekai", "Magic", "Mecha", "Military", "Music", "Cooking", "Medical",
  "Game", "Demons", "Vampires", "Zombies", "Time Travel", "Reincarnation",
  "Virtual Reality", "Gender Bender", "Tragedy", "Crime", "Police",
  "Cultivation", "Xianxia", "Wuxia", "Post-Apocalyptic", "Survival",
  "Harem", "Ecchi", "Office Workers", "Monster Girls", "Murim",
  "Regression", "Overpowered", "Shounen", "Seinen", "Shoujo", "Josei",
];

const STATUSES = [
  { value: "ONGOING",   label: "Ongoing"   },
  { value: "COMPLETED", label: "Completed" },
  { value: "HIATUS",    label: "Hiatus"    },
  { value: "CANCELLED", label: "Cancelled" },
];

const TYPES = [
  { value: "manhwa",  label: "Manhwa"    },
  { value: "manhua",  label: "Manhua"    },
  { value: "webtoon", label: "Webtoon"   },
  { value: "manga",   label: "Manga (JP)"},
];

// ── helpers ───────────────────────────────────────────────────────────────────

function FilterBtn({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active
          ? "bg-orange-500 text-white border-orange-500"
          : "bg-transparent text-zinc-400 border-zinc-700 hover:border-zinc-500 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function Browse() {
  const {
    mangaList, total, page, totalPages,
    query, status, type, genre,
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState(query);
  const [showAllGenres, setShowAllGenres] = useState(false);

  // Build a URL that preserves current filters while changing one param
  const buildUrl = useCallback((overrides: Record<string, string>) => {
    const p = new URLSearchParams();
    if (query)  p.set("q",      query);
    if (status) p.set("status", status);
    if (type)   p.set("type",   type);
    if (genre)  p.set("genre",  genre);
    if (page > 1) p.set("page", String(page));
    for (const [k, v] of Object.entries(overrides)) {
      if (v) p.set(k, v); else p.delete(k);
    }
    // Reset to page 1 when any filter changes (but not when just changing page)
    if (!("page" in overrides)) p.delete("page");
    return `/browse?${p.toString()}`;
  }, [query, status, type, genre, page]);

  const setFilter = (key: string, value: string) =>
    navigate(buildUrl({ [key]: value }));

  const clearAll = () => navigate("/browse");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (q.length >= 3)     navigate(`/browse?q=${encodeURIComponent(q)}`);
    else if (q.length === 0) navigate("/browse");
  };

  const hasFilters = status || type || genre || query;
  const GENRES_INITIAL = 21;
  const visibleGenres  = showAllGenres ? GENRES : GENRES.slice(0, GENRES_INITIAL);

  return (
    <div className="min-h-screen bg-zinc-950 text-white pb-16">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="bg-zinc-950 border-b border-zinc-800/60 px-4 py-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-white">Browse</h1>
            {total > 0 && (
              <span className="text-xs text-zinc-600">{total.toLocaleString()} titles in library</span>
            )}
          </div>

          <form onSubmit={handleSearch} className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none">
              <SearchIcon />
            </span>
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Search manga, manhwa, manhua… (min. 3 characters)"
              className="w-full bg-zinc-900 border border-zinc-700 focus:border-orange-500 rounded-xl pl-11 pr-12 py-3 text-white placeholder-zinc-500 text-sm transition-colors outline-none"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => { setSearchInput(""); navigate("/browse"); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
              >
                <XIcon />
              </button>
            )}
          </form>

          {searchInput.length > 0 && searchInput.trim().length < 3 && (
            <p className="text-xs text-zinc-500 mt-2 ml-1">
              Type at least 3 characters to search
            </p>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4">

        {/* ── Filters ───────────────────────────────────────────────────── */}
        <div className="py-5 space-y-4 border-b border-zinc-800/60">

            {/* Status */}
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-2.5">Status</p>
              <div className="flex flex-wrap gap-2">
                <FilterBtn active={!status} onClick={() => setFilter("status", "")}>All</FilterBtn>
                {STATUSES.map(s => (
                  <FilterBtn
                    key={s.value}
                    active={status === s.value}
                    onClick={() => setFilter("status", status === s.value ? "" : s.value)}
                  >
                    {s.label}
                  </FilterBtn>
                ))}
              </div>
            </div>

            {/* Type */}
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-2.5">Type</p>
              <div className="flex flex-wrap gap-2">
                <FilterBtn active={!type} onClick={() => setFilter("type", "")}>All</FilterBtn>
                {TYPES.map(t => (
                  <FilterBtn
                    key={t.value}
                    active={type === t.value}
                    onClick={() => setFilter("type", type === t.value ? "" : t.value)}
                  >
                    {t.label}
                  </FilterBtn>
                ))}
              </div>
            </div>

            {/* Genre */}
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-2.5">Genre</p>
              <div className="flex flex-wrap gap-2">
                <FilterBtn active={!genre} onClick={() => setFilter("genre", "")}>All</FilterBtn>
                {visibleGenres.map(g => (
                  <FilterBtn
                    key={g}
                    active={genre === g}
                    onClick={() => setFilter("genre", genre === g ? "" : g)}
                  >
                    {g}
                  </FilterBtn>
                ))}
                <button
                  onClick={() => setShowAllGenres(v => !v)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-zinc-700 text-zinc-500 hover:text-white hover:border-zinc-500 transition-colors"
                >
                  <ChevronIcon dir={showAllGenres ? "up" : "down"} size={14} />
                  {showAllGenres ? "Show less" : `${GENRES.length - GENRES_INITIAL} more`}
                </button>
              </div>
            </div>

            {/* Active filter badges */}
            {hasFilters && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {status && (
                  <span className="inline-flex items-center gap-1.5 bg-orange-500/15 text-orange-400 text-xs font-medium px-2.5 py-1 rounded-full">
                    {STATUSES.find(s => s.value === status)?.label}
                    <button onClick={() => setFilter("status", "")}><XIcon size={11} /></button>
                  </span>
                )}
                {type && (
                  <span className="inline-flex items-center gap-1.5 bg-orange-500/15 text-orange-400 text-xs font-medium px-2.5 py-1 rounded-full">
                    {TYPES.find(t => t.value === type)?.label ?? type}
                    <button onClick={() => setFilter("type", "")}><XIcon size={11} /></button>
                  </span>
                )}
                {genre && (
                  <span className="inline-flex items-center gap-1.5 bg-orange-500/15 text-orange-400 text-xs font-medium px-2.5 py-1 rounded-full">
                    {genre}
                    <button onClick={() => setFilter("genre", "")}><XIcon size={11} /></button>
                  </span>
                )}
                <button onClick={clearAll} className="text-xs text-zinc-500 hover:text-white transition-colors ml-auto">
                  Clear all
                </button>
              </div>
            )}
          </div>

        {/* ── Results ───────────────────────────────────────────────────── */}
        <div className="py-6">
          <p className="text-sm text-zinc-500 mb-5">
            {query
              ? `${total.toLocaleString()} result${total !== 1 ? "s" : ""} for "${query}"`
              : `Showing ${mangaList.length > 0 ? (page - 1) * 48 + 1 : 0}–${Math.min(page * 48, total)} of ${total.toLocaleString()} titles`
            }
          </p>

          {mangaList.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-sm font-medium text-zinc-500">
                {query ? `No results for "${query}"` : "No titles match your filters"}
              </p>
              {hasFilters && (
                <button onClick={clearAll} className="mt-2 text-xs text-orange-400 hover:text-orange-300">
                  Clear all filters
                </button>
              )}
              {total === 0 && !hasFilters && (
                <p className="text-xs text-zinc-600 mt-2">
                  The database is still syncing — check back in a minute.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                {mangaList.map((m: any, idx: number) => (
                  <Link
                    key={`${m.id}-${idx}`}
                    to={`/manga/${m.id}`}
                    className="group flex flex-col"
                  >
                    <div
                      className="relative rounded-lg overflow-hidden mb-2 bg-zinc-800"
                      style={{ aspectRatio: "2/3" }}
                    >
                      <img
                        src={imgUrl(m.thumbnailUrl)}
                        alt={m.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      {m.status && m.status !== "UNKNOWN" && (
                        <div className="absolute top-1.5 right-1.5">
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded leading-none ${
                            m.status === "ONGOING"   ? "bg-green-500/80 text-white"        :
                            m.status === "COMPLETED" ? "bg-blue-500/80 text-white"          :
                            m.status === "HIATUS"    ? "bg-yellow-500/80 text-zinc-900"     :
                            "bg-zinc-700/80 text-zinc-300"
                          }`}>
                            {m.status.charAt(0) + m.status.slice(1).toLowerCase()}
                          </span>
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pt-4 pb-1">
                        <span className="text-[9px] text-zinc-300 leading-none">{m.sourceName}</span>
                      </div>
                    </div>
                    <p className="text-white text-xs font-medium leading-snug line-clamp-2 group-hover:text-orange-400 transition-colors">
                      {m.title}
                    </p>
                    {Array.isArray(m.genre) && m.genre.length > 0 && (
                      <p className="text-zinc-600 text-[10px] mt-0.5 truncate">
                        {(m.genre as string[]).slice(0, 3).join(", ")}
                      </p>
                    )}
                  </Link>
                ))}
              </div>

              {/* ── Pagination ──────────────────────────────────────────── */}
              {totalPages > 1 && (
                <>
                  {/* Mobile: Prev · page X/Y · Next */}
                  <div className="flex sm:hidden items-center justify-between gap-2 mt-10">
                    <button
                      disabled={page <= 1}
                      onClick={() => navigate(buildUrl({ page: String(page - 1) }))}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronIcon dir="left" size={16} /> Prev
                    </button>
                    <span className="text-sm text-zinc-400 tabular-nums">{page} / {totalPages}</span>
                    <button
                      disabled={page >= totalPages}
                      onClick={() => navigate(buildUrl({ page: String(page + 1) }))}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Next <ChevronIcon dir="right" size={16} />
                    </button>
                  </div>

                  {/* Desktop: Prev · numbered pages · Next */}
                  <div className="hidden sm:flex items-center justify-center gap-2 mt-10">
                    <button
                      disabled={page <= 1}
                      onClick={() => navigate(buildUrl({ page: String(page - 1) }))}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronIcon dir="left" size={16} /> Prev
                    </button>

                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                        let p: number;
                        if (totalPages <= 7)         p = i + 1;
                        else if (page <= 4)          p = i + 1;
                        else if (page >= totalPages - 3) p = totalPages - 6 + i;
                        else                         p = page - 3 + i;
                        return (
                          <button
                            key={p}
                            onClick={() => navigate(buildUrl({ page: String(p) }))}
                            className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                              p === page
                                ? "bg-orange-500 text-white"
                                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                            }`}
                          >
                            {p}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      disabled={page >= totalPages}
                      onClick={() => navigate(buildUrl({ page: String(page + 1) }))}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Next <ChevronIcon dir="right" size={16} />
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
