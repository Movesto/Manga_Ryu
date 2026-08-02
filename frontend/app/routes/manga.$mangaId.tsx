import { useState, useEffect } from "react";
import { useLoaderData, Link, useFetcher, useNavigate, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/manga.$mangaId";
import { data } from "react-router";
import { getSession, sessionHeaders } from "../lib/auth.server";
import { API, imgUrl } from "../lib/config";
import { chNum, relativeTime } from "../lib/utils";
import { BookmarkIcon, PlayIcon, ArrowLeftIcon, ChevronIcon, DownloadIcon } from "../components/icons";

export function meta({ data }: Route.MetaArgs) {
  const title = data?.manga?.title;
  return [
    { title: title ? `${title} — Manga Ryu` : "Manga Ryu" },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const id = params.mangaId;
  const session = await getSession(request);
  const { user } = session;

  const fetchPromises: Promise<any>[] = [
    fetch(`${API}/api/manga/${id}`),
    fetch(`${API}/api/manga/${id}/chapters`),
  ];

  if (user) {
    const token = session.token!;
    fetchPromises.push(
      fetch(`${API}/api/bookmarks/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => null)
    );
    fetchPromises.push(
      fetch(`${API}/api/history/read-chapters/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => null)
    );
  }

  const results = await Promise.allSettled(fetchPromises);
  const detailRes   = results[0].status === "fulfilled" ? results[0].value : null;
  const chaptersRes = results[1].status === "fulfilled" ? results[1].value : null;
  const bookmarkRes = results[2]?.status === "fulfilled" ? results[2].value : null;
  const readRes     = results[3]?.status === "fulfilled" ? results[3].value : null;

  const manga    = detailRes   ? await detailRes.json()   : {};
  const raw      = chaptersRes ? await chaptersRes.json() : [];
  const chapters = Array.isArray(raw)
    ? [...raw].sort((a, b) => b.chapterNumber - a.chapterNumber)
    : [];

  let bookmarked = false;
  if (bookmarkRes?.ok) {
    const bData = await bookmarkRes.json();
    bookmarked = bData.bookmarked ?? false;
  }

  let readChapterIds: number[] = [];
  let lastRead: { chapterId: number; chapterNumber: number | null } | null = null;
  if (readRes?.ok) {
    const rData = await readRes.json();
    readChapterIds = rData.readChapterIds ?? [];
    lastRead = rData.lastRead ?? null;
  }

  return data(
    { manga, chapters, user, bookmarked, readChapterIds, lastRead },
    { headers: sessionHeaders(session) },
  );
}

// ── sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: string }) {
  const styles: Record<string, string> = {
    ONGOING:   "bg-green-500/15 text-green-400 border-green-500/30",
    COMPLETED: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    HIATUS:    "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    CANCELLED: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  const labels: Record<string, string> = {
    ONGOING: "Ongoing", COMPLETED: "Completed",
    HIATUS: "Hiatus", CANCELLED: "Cancelled",
  };
  const key = status?.toUpperCase() ?? "";
  const cls = styles[key] ?? "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
  const lbl = labels[key] ?? (status ?? "Unknown");
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {lbl}
    </span>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

type DlState =
  | { status: "idle" }
  | { status: "loading"; progress: number; stage: string }
  | { status: "done" }
  | { status: "error"; message: string };

export default function MangaDetail() {
  const { manga, chapters, user, bookmarked: initialBookmarked, readChapterIds, lastRead } = useLoaderData<typeof loader>();
  const readSet = new Set(readChapterIds);
  const [descExpanded, setDescExpanded] = useState(false);
  const [chapSort, setChapSort] = useState<"desc" | "asc">("desc");
  const [dlStates, setDlStates] = useState<Record<number, DlState>>({});
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bundleState, setBundleState] = useState<DlState>({ status: "idle" });
  const bookmarkFetcher = useFetcher<{ bookmarked: boolean }>();
  const navigate = useNavigate();
  const { csrf } = useRouteLoaderData("root") as { csrf: string };

  // ── offline (in-app) downloads: save chapters to read with no connection ────
  const [offline, setOffline] = useState<Record<number, "idle" | "saving" | "saved">>({});
  const [offlinePct, setOfflinePct] = useState<Record<number, number>>({});

  useEffect(() => {
    // Mark which chapters are already saved offline.
    import("../lib/downloads").then((dl) =>
      dl.listDownloads().then((list) => {
        const saved: Record<number, "saved"> = {};
        for (const c of list) if (c.mangaId === String(manga.id)) saved[Number(c.id)] = "saved";
        setOffline((s) => ({ ...saved, ...s }));
      }),
    );
  }, [manga.id]);

  async function toggleOffline(ch: any) {
    const id = ch.id as number;
    if (offline[id] === "saving") return;
    const dl = await import("../lib/downloads");
    if (offline[id] === "saved") {
      await dl.deleteChapter(String(id));
      setOffline((s) => ({ ...s, [id]: "idle" }));
      return;
    }
    setOffline((s) => ({ ...s, [id]: "saving" }));
    setOfflinePct((p) => ({ ...p, [id]: 0 }));
    try {
      // The manga page doesn't hold page URLs — fetch them like the reader does.
      const res = await fetch(`/api/manga/${manga.id}/chapter/${id}`);
      const data = await res.json();
      const raw: string[] = Array.isArray(data?.pageList) ? data.pageList : Array.isArray(data) ? data : [];
      const pages = raw.map((p) => (p.startsWith("http") ? p : `/media${p}`));
      if (pages.length === 0) throw new Error("no pages");
      await dl.downloadChapter(
        {
          id: String(id),
          mangaId: String(manga.id),
          mangaTitle: manga.title ?? "",
          mangaThumb: manga.thumbnailUrl ? `/media${manga.thumbnailUrl}` : "",
          chapterName: ch.name ?? "",
          chapterNumber: ch.chapterNumber ?? 0,
          pages,
        },
        (done, total) => setOfflinePct((p) => ({ ...p, [id]: total ? Math.round((done / total) * 100) : 0 })),
      );
      setOffline((s) => ({ ...s, [id]: "saved" }));
    } catch {
      setOffline((s) => ({ ...s, [id]: "idle" }));
    }
  }

  const sortedChapters = chapSort === "desc" ? chapters : [...chapters].reverse();
  const firstChapter   = chapters[chapters.length - 1];
  const latestChapter  = chapters[0];
  const hasDescription = manga.description && manga.description.trim().length > 0;
  const genres: string[] = Array.isArray(manga.genre) ? manga.genre : [];
  const sourceName: string = manga.source?.name ?? manga.sourceName ?? "";

  const isBookmarked = bookmarkFetcher.data !== undefined
    ? bookmarkFetcher.data.bookmarked
    : initialBookmarked;
  const bookmarkPending = bookmarkFetcher.state !== "idle";

  function handleBookmark() {
    if (!user) {
      navigate(`/signin?next=/manga/${manga.id}`);
      return;
    }
    bookmarkFetcher.submit(
      { manga_id: manga.id, intent: isBookmarked ? "remove" : "add", csrf_token: csrf },
      { method: "post", action: "/bookmark" }
    );
  }

  async function runJob(
    startReq: () => Promise<Response>,
    onProgress: (state: DlState) => void,
    fallbackFilename: string,
  ) {
    const startRes = await startReq();
    if (!startRes.ok) throw new Error(await startRes.text().catch(() => "Request failed"));
    const { job_id } = await startRes.json();

    while (true) {
      await new Promise(r => setTimeout(r, 1200));
      const pollRes = await fetch(`/api/jobs/${job_id}`);
      if (!pollRes.ok) throw new Error("Lost track of job");
      const job = await pollRes.json();
      if (job.status === "error") throw new Error(job.stage || "Failed");
      onProgress({ status: "loading", progress: job.progress ?? 0, stage: job.stage ?? "" });
      if (job.status === "done") break;
    }

    onProgress({ status: "loading", progress: 100, stage: "Saving file..." });
    const fileRes = await fetch(`/api/jobs/${job_id}/file`);
    if (!fileRes.ok) throw new Error("Failed to retrieve file");
    const blob  = await fileRes.blob();
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement("a");
    const cd    = fileRes.headers.get("content-disposition") ?? "";
    const match = cd.match(/filename="?([^"]+)"?/);
    a.href      = url;
    a.download  = match ? match[1] : fallbackFilename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadChapter(chId: number, chNum: number) {
    setDlStates(s => ({ ...s, [chId]: { status: "loading", progress: 0, stage: "Starting..." } }));
    try {
      await runJob(
        () => fetch(`/api/manga/${manga.id}/download/pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({ chapter_ids: [chId] }),
        }),
        state => setDlStates(s => ({ ...s, [chId]: state })),
        `chapter-${chNum}.pdf`,
      );
      setDlStates(s => ({ ...s, [chId]: { status: "done" } }));
      setTimeout(() => setDlStates(s => ({ ...s, [chId]: { status: "idle" } })), 3000);
    } catch (err: any) {
      setDlStates(s => ({ ...s, [chId]: { status: "error", message: err?.message || "Failed" } }));
      setTimeout(() => setDlStates(s => ({ ...s, [chId]: { status: "idle" } })), 6000);
    }
  }

  async function downloadBundle() {
    if (selected.size === 0) return;
    // Order by chapter number (same order as the sorted list)
    const ids = chapters
      .filter(c => selected.has(c.id))
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
      .map(c => c.id);
    setBundleState({ status: "loading", progress: 0, stage: "Starting..." });
    try {
      await runJob(
        () => fetch(`/api/manga/${manga.id}/download/pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({ chapter_ids: ids }),
        }),
        state => setBundleState(state),
        `${manga.title} - Bundle.pdf`,
      );
      setBundleState({ status: "done" });
      setSelected(new Set());
      setSelecting(false);
      setTimeout(() => setBundleState({ status: "idle" }), 3000);
    } catch (err: any) {
      setBundleState({ status: "error", message: err?.message || "Failed" });
      setTimeout(() => setBundleState({ status: "idle" }), 6000);
    }
  }

  function toggleSelect(id: number) {
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative pb-10 pt-4">
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: `url(${imgUrl(manga.thumbnailUrl)})`,
            backgroundSize: "cover",
            backgroundPosition: "center top",
            filter: "blur(36px) brightness(0.18)",
            transform: "scale(1.12)",
          }}
        />
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-zinc-950/50 via-transparent to-zinc-950" />

        <div className="relative z-10 max-w-5xl mx-auto px-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm mb-6"
          >
            <ArrowLeftIcon />
            Back
          </Link>

          <div className="flex flex-col sm:flex-row gap-6 sm:gap-8">
            {/* Cover */}
            <div className="flex-shrink-0 mx-auto sm:mx-0">
              <div className="relative">
                <img
                  src={imgUrl(manga.thumbnailUrl)}
                  alt={manga.title}
                  className="w-36 sm:w-48 md:w-56 rounded-2xl shadow-2xl object-cover"
                  style={{ aspectRatio: "2/3" }}
                />
                <div className="absolute inset-0 rounded-2xl ring-1 ring-white/10" />
              </div>
            </div>

            {/* Meta */}
            <div className="flex flex-col gap-3 flex-1 text-center sm:text-left">
              <h1 className="text-2xl sm:text-3xl font-bold leading-tight text-white">
                {manga.title}
              </h1>

              {(manga.author || manga.artist) && (
                <p className="text-sm text-zinc-400">
                  {[manga.author, manga.artist !== manga.author && manga.artist]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}

              <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                <StatusBadge status={manga.status} />
                {manga.rating != null && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-yellow-500/10 text-yellow-400 border-yellow-500/30">
                    ★ {(manga.rating / 10).toFixed(1)}
                  </span>
                )}
                {sourceName && (
                  <span className="text-xs font-medium bg-zinc-800 text-zinc-300 px-2.5 py-1 rounded-full border border-zinc-700">
                    {sourceName}
                  </span>
                )}
                {chapters.length > 0 && (
                  <span className="text-xs font-medium bg-zinc-800 text-zinc-300 px-2.5 py-1 rounded-full border border-zinc-700">
                    {chapters.length} chapters
                  </span>
                )}
              </div>

              {genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 justify-center sm:justify-start">
                  {genres.map((g) => (
                    <span
                      key={g}
                      className="text-xs text-zinc-400 bg-zinc-900/80 px-2.5 py-0.5 rounded-full border border-zinc-800"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}

              {/* CTA buttons */}
              <div className="flex flex-col xs:flex-row flex-wrap gap-2 sm:gap-3 justify-center sm:justify-start mt-1">
                {lastRead ? (
                  <>
                    <Link
                      to={`/manga/${manga.id}/chapter/${lastRead.chapterId}`}
                      className="inline-flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors"
                    >
                      <PlayIcon />
                      Continue Ch.{lastRead.chapterNumber != null ? ` ${chNum(lastRead.chapterNumber)}` : ""}
                    </Link>
                    {firstChapter && (
                      <Link
                        to={`/manga/${manga.id}/chapter/${firstChapter.id}`}
                        className="inline-flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-sm px-5 py-2.5 rounded-xl border border-zinc-700 transition-colors"
                      >
                        Start Over
                      </Link>
                    )}
                  </>
                ) : (
                  <>
                    {firstChapter && (
                      <Link
                        to={`/manga/${manga.id}/chapter/${firstChapter.id}`}
                        className="inline-flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors"
                      >
                        <PlayIcon />
                        Start Reading
                      </Link>
                    )}
                    {latestChapter && latestChapter.id !== firstChapter?.id && (
                      <Link
                        to={`/manga/${manga.id}/chapter/${latestChapter.id}`}
                        className="inline-flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-sm px-5 py-2.5 rounded-xl border border-zinc-700 transition-colors"
                      >
                        Latest Chapter
                      </Link>
                    )}
                  </>
                )}
                <button
                  onClick={handleBookmark}
                  disabled={bookmarkPending}
                  className={`inline-flex items-center justify-center gap-2 text-sm px-4 py-2.5 rounded-xl border transition-colors disabled:opacity-60 ${
                    isBookmarked
                      ? "bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border-orange-500/40"
                      : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700"
                  }`}
                >
                  <BookmarkIcon filled={isBookmarked} />
                  {isBookmarked ? "Bookmarked" : user ? "Bookmark" : "Sign in"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Description ──────────────────────────────────────────────────── */}
      {hasDescription && (
        <section className="max-w-5xl mx-auto px-4 py-6 border-t border-zinc-800/60">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest mb-3">
            Synopsis
          </h2>
          <p className={`text-sm text-zinc-300 leading-relaxed ${descExpanded ? "" : "line-clamp-4"}`}>
            {manga.description}
          </p>
          <button
            onClick={() => setDescExpanded((v) => !v)}
            className="mt-2 flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors font-medium"
          >
            {descExpanded ? <><ChevronIcon dir="up" size={14} /> Show less</> : <><ChevronIcon dir="down" size={14} /> Show more</>}
          </button>
        </section>
      )}

      {/* ── Chapter list ─────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-4 py-6 border-t border-zinc-800/60">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <h2 className="text-base font-bold text-white">
            {chapters.length > 0
              ? `${chapters.length} Chapter${chapters.length !== 1 ? "s" : ""}`
              : "Chapters"}
          </h2>
          <div className="flex items-center gap-2">
            {chapters.length > 1 && (
              <button
                onClick={() => { setSelecting(v => !v); setSelected(new Set()); }}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  selecting
                    ? "bg-orange-500/20 text-orange-400 border-orange-500/40"
                    : "text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 border-zinc-700"
                }`}
              >
                {selecting ? "Cancel" : "Select"}
              </button>
            )}
            {chapters.length > 1 && (
              <button
                onClick={() => setChapSort((s) => (s === "desc" ? "asc" : "desc"))}
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
              >
                {chapSort === "desc" ? <><ChevronIcon dir="down" size={14} /> Newest first</> : <><ChevronIcon dir="up" size={14} /> Oldest first</>}
              </button>
            )}
          </div>
        </div>

        {chapters.length === 0 ? (
          <div className="py-12 text-center text-zinc-600">
            <p className="text-sm">No chapters available yet.</p>
            <p className="text-xs mt-1">Check back later or browse the source directly.</p>
          </div>
        ) : (
          <>
          <div className="flex flex-col divide-y divide-zinc-800/50">
            {sortedChapters.map((ch, idx) => {
              const dlState: DlState = dlStates[ch.id] ?? { status: "idle" };
              const isLoading  = dlState.status === "loading";
              const isSelected = selected.has(ch.id);
              const isRead     = ch.read || readSet.has(ch.id);
              return (
                <div key={ch.id ?? idx} className="group relative flex flex-col rounded-xl hover:bg-zinc-900 overflow-hidden transition-colors">
                  <div className="flex items-center gap-1 px-2 sm:px-3">

                    {/* Checkbox in select mode */}
                    {selecting && (
                      <button
                        onClick={() => toggleSelect(ch.id)}
                        className={`flex-shrink-0 w-5 h-5 rounded border transition-colors ${
                          isSelected
                            ? "bg-orange-500 border-orange-500"
                            : "border-zinc-600 hover:border-zinc-400 bg-transparent"
                        }`}
                        aria-label={isSelected ? "Deselect" : "Select"}
                      >
                        {isSelected && (
                          <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                            <path d="M2 6l3 3 5-5" />
                          </svg>
                        )}
                      </button>
                    )}

                    <Link
                      to={`/manga/${manga.id}/chapter/${ch.id}`}
                      className="flex items-center gap-3 sm:gap-4 py-3 flex-1 min-w-0"
                      onClick={selecting ? e => { e.preventDefault(); toggleSelect(ch.id); } : undefined}
                    >
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isRead ? "bg-zinc-700" : "bg-orange-400"}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${isRead ? "text-zinc-500 group-hover:text-zinc-400" : "text-white group-hover:text-orange-400"} transition-colors`}>
                          {ch.name && ch.name.toLowerCase() !== `chapter ${chNum(ch.chapterNumber)}`.toLowerCase()
                            ? ch.name
                            : `Chapter ${chNum(ch.chapterNumber)}`}
                        </p>
                        {ch.scanlator && (
                          <p className="text-xs text-zinc-600 mt-0.5 truncate">{ch.scanlator}</p>
                        )}
                      </div>
                    </Link>

                    {!selecting && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {isLoading ? (
                          <span className="text-[11px] text-orange-400/80 max-w-[90px] truncate text-right">
                            {dlState.stage}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-600 group-hover:text-zinc-500 transition-colors">
                            {relativeTime(ch.uploadDate)}
                          </span>
                        )}
                        <button
                          onClick={() => downloadChapter(ch.id, ch.chapterNumber)}
                          disabled={isLoading}
                          title={
                            dlState.status === "loading" ? dlState.stage
                            : dlState.status === "done"  ? "Downloaded!"
                            : dlState.status === "error" ? dlState.message
                            : "Download as PDF"
                          }
                          className={`p-2 rounded-lg transition-colors ${
                            isLoading                    ? "text-orange-400 cursor-wait"
                            : dlState.status === "done"  ? "text-green-400"
                            : dlState.status === "error" ? "text-red-400"
                            : "text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800"
                          }`}
                        >
                          {isLoading ? (
                            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            </svg>
                          ) : (
                            <DownloadIcon size={14} />
                          )}
                        </button>

                        {/* Offline (in-app) save — read with no connection */}
                        <button
                          onClick={() => toggleOffline(ch)}
                          disabled={offline[ch.id] === "saving"}
                          title={
                            offline[ch.id] === "saving" ? "Saving…"
                            : offline[ch.id] === "saved" ? "Saved offline — tap to remove"
                            : "Save for offline reading"
                          }
                          className={`p-2 rounded-lg transition-colors ${
                            offline[ch.id] === "saving" ? "text-orange-400 cursor-wait"
                            : offline[ch.id] === "saved" ? "text-orange-400"
                            : "text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800"
                          }`}
                        >
                          {offline[ch.id] === "saving" ? (
                            <span className="text-[10px] font-semibold tabular-nums w-[26px] inline-block text-center">
                              {offlinePct[ch.id] ?? 0}%
                            </span>
                          ) : offline[ch.id] === "saved" ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="8 12 11 15 16 9" />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {isLoading && (
                    <div className="h-[3px] bg-zinc-800">
                      <div
                        className="h-full bg-orange-500 transition-all duration-500 ease-out"
                        style={{ width: `${dlState.progress}%` }}
                      />
                    </div>
                  )}
                  {dlState.status === "error" && (
                    <div className="px-3 pb-2 text-[11px] text-red-400 truncate">
                      {dlState.message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bundle download bar */}
          {selecting && (
            <div className="mt-4 p-3 bg-zinc-900 border border-zinc-700 rounded-xl">
              {bundleState.status === "loading" ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-orange-400">{bundleState.stage}</span>
                    <span className="text-xs text-zinc-500">{bundleState.progress}%</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-orange-500 transition-all duration-500 ease-out rounded-full"
                      style={{ width: `${bundleState.progress}%` }}
                    />
                  </div>
                </div>
              ) : bundleState.status === "error" ? (
                <p className="text-sm text-red-400">{bundleState.message}</p>
              ) : bundleState.status === "done" ? (
                <p className="text-sm text-green-400">Bundle downloaded!</p>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-white font-medium">
                      {selected.size === 0
                        ? "Select chapters to bundle"
                        : `${selected.size} chapter${selected.size !== 1 ? "s" : ""} selected`}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Downloads as one PDF — opens in any PDF reader, works offline
                    </p>
                  </div>
                  <button
                    onClick={downloadBundle}
                    disabled={selected.size === 0}
                    className="flex-shrink-0 flex items-center gap-2 bg-orange-500 hover:bg-orange-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                  >
                    <DownloadIcon size={14} />
                    Download
                  </button>
                </div>
              )}
            </div>
          )}
          </>
        )}
      </section>

      <div className="h-16" />
    </div>
  );
}
