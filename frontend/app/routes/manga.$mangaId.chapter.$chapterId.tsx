import { useState, useEffect, useRef, useCallback } from "react";
import { useLoaderData, Link, useNavigate, useRevalidator, data } from "react-router";
import { API } from "../lib/config";
import { getSession, sessionHeaders } from "../lib/auth.server";
import { chNum } from "../lib/utils";
import { ArrowLeftIcon, ArrowRightIcon, ChevronIcon, WidthIcon } from "../components/icons";

export async function loader({ params, request }: { params: Record<string, string>; request: Request }) {
  const { mangaId, chapterId } = params;
  const session = await getSession(request);
  const token = session.token;

  const [pagesRes, chaptersRes, mangaRes] = await Promise.all([
    fetch(`${API}/api/manga/${mangaId}/chapter/${chapterId}`),
    fetch(`${API}/api/manga/${mangaId}/chapters`),
    fetch(`${API}/api/manga/${mangaId}`),
  ]);

  const pagesData   = await pagesRes.json();
  const chaptersRaw = await chaptersRes.json();
  const manga       = await mangaRes.json();

  const rawList: string[] = Array.isArray(pagesData?.pageList)
    ? pagesData.pageList
    : Array.isArray(pagesData)
    ? pagesData
    : [];

  const pages = rawList.map((p: string) =>
    p.startsWith("http") ? p : `/media${p}`
  );

  const allChapters: any[] = Array.isArray(chaptersRaw)
    ? [...chaptersRaw].sort((a, b) => b.chapterNumber - a.chapterNumber)
    : [];

  const idx            = allChapters.findIndex(c => String(c.id) === String(chapterId));
  const currentChapter = allChapters[idx] ?? pagesData;
  const nextChapter    = idx > 0                       ? allChapters[idx - 1] : null;
  const prevChapter    = idx < allChapters.length - 1  ? allChapters[idx + 1] : null;

  // Mark chapter as read for logged-in users (fire-and-forget)
  if (token) {
    fetch(`${API}/api/history/mark`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        manga_id:        parseInt(mangaId),
        chapter_id:      parseInt(chapterId),
        chapter_number:  currentChapter?.chapterNumber ?? null,
        manga_title:     manga?.title ?? null,
        manga_thumbnail: manga?.thumbnailUrl ?? null,
      }),
    }).catch(() => {});
  }

  return data(
    { pages, manga, currentChapter, nextChapter, prevChapter, mangaId, chapterId },
    { headers: sessionHeaders(session) },
  );
}

// ── width modes ───────────────────────────────────────────────────────────────

const WIDTH_MODES = ["comfortable", "wide", "full"] as const;
type WidthMode = typeof WIDTH_MODES[number];

const WIDTH_CLASS: Record<WidthMode, string> = {
  comfortable: "max-w-[720px]",
  wide:        "max-w-[960px]",
  full:        "max-w-none",
};

const WIDTH_LABEL: Record<WidthMode, string> = {
  comfortable: "Comfortable",
  wide:        "Wide",
  full:        "Full width",
};

// ── download glyphs ────────────────────────────────────────────────────────────

function DownloadGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function DownloadedGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="8 12 11 15 16 9" />
    </svg>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function ChapterReader() {
  const { pages, manga, currentChapter, nextChapter, prevChapter, mangaId } =
    useLoaderData<typeof loader>();

  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const [widthMode, setWidthMode] = useState<WidthMode>("comfortable");

  // ── offline download state ───────────────────────────────────────────────
  const [dlState, setDlState] = useState<"idle" | "saved" | "downloading">("idle");
  const [dlProgress, setDlProgress] = useState({ done: 0, total: 0 });
  const chapterIdStr = String(currentChapter?.id ?? "");

  useEffect(() => {
    if (!chapterIdStr) return;
    import("../lib/downloads").then((dl) =>
      dl.isDownloaded(chapterIdStr).then((yes) => setDlState(yes ? "saved" : "idle")),
    );
  }, [chapterIdStr]);

  async function handleDownload() {
    if (dlState === "downloading" || !chapterIdStr) return;
    const dl = await import("../lib/downloads");
    if (dlState === "saved") {
      await dl.deleteChapter(chapterIdStr);
      setDlState("idle");
      return;
    }
    setDlState("downloading");
    setDlProgress({ done: 0, total: pages.length });
    try {
      await dl.downloadChapter(
        {
          id: chapterIdStr,
          mangaId: String(mangaId),
          mangaTitle: manga?.title ?? "",
          mangaThumb: manga?.thumbnailUrl ? `/media${manga.thumbnailUrl}` : "",
          chapterName: currentChapter?.name ?? "",
          chapterNumber: currentChapter?.chapterNumber ?? 0,
          pages,
        },
        (done, total) => setDlProgress({ done, total }),
      );
      setDlState("saved");
    } catch {
      setDlState("idle");
    }
  }

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lastScrollY   = useRef(0);
  const lastTapTime   = useRef(0);
  const initialTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load saved width preference
  useEffect(() => {
    const saved = localStorage.getItem("reader-width");
    if (saved && (WIDTH_MODES as readonly string[]).includes(saved)) {
      setWidthMode(saved as WidthMode);
    }
  }, []);

  // Show on load for 3s so the user knows controls exist, then hide
  useEffect(() => {
    initialTimer.current = setTimeout(() => setControlsVisible(false), 3000);
    return () => { if (initialTimer.current) clearTimeout(initialTimer.current); };
  }, []);

  // Scroll-direction: down → hide, up → show
  useEffect(() => {
    const onScroll = () => {
      const y    = window.scrollY;
      const diff = y - lastScrollY.current;
      if (diff > 8)       setControlsVisible(false);
      else if (diff < -8) setControlsVisible(true);
      lastScrollY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Double-tap / double-click to toggle controls
  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapTime.current < 300) {
      setControlsVisible(v => !v);
      lastTapTime.current = 0;
    } else {
      lastTapTime.current = now;
    }
  }, []);

  // ── track current page via IntersectionObserver ───────────────────────────
  useEffect(() => {
    if (pages.length === 0) return;
    const observers: IntersectionObserver[] = [];

    pageRefs.current.forEach((el, i) => {
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setCurrentPage(i + 1); },
        { threshold: 0.5 }
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach(o => o.disconnect());
  }, [pages.length]);

  // ── keyboard navigation ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        if (nextChapter) navigate(`/manga/${mangaId}/chapter/${nextChapter.id}`);
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        if (prevChapter) navigate(`/manga/${mangaId}/chapter/${prevChapter.id}`);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [nextChapter, prevChapter, mangaId, navigate]);

  const cycleWidth = () => {
    setWidthMode(m => {
      const idx  = WIDTH_MODES.indexOf(m);
      const next = WIDTH_MODES[(idx + 1) % WIDTH_MODES.length];
      localStorage.setItem("reader-width", next);
      return next;
    });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
      if (dx < 0 && nextChapter) navigate(`/manga/${mangaId}/chapter/${nextChapter.id}`);
      if (dx > 0 && prevChapter) navigate(`/manga/${mangaId}/chapter/${prevChapter.id}`);
    }
  };

  const chapterName = currentChapter?.name
    ?? (currentChapter?.chapterNumber != null
      ? `Chapter ${chNum(currentChapter.chapterNumber)}`
      : "Chapter");

  return (
    <div
      className="min-h-screen bg-[#0a0a0a] text-white"
      onClick={handleTap}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Spacer for fixed navbar in reading mode */}
      <div className="h-14" />

      {/* ── Sticky chapter bar ─────────────────────────────────────────── */}
      <div
        className={`sticky z-40 transition-all duration-300 ${
          controlsVisible
            ? "top-14 opacity-100 translate-y-0"
            : "top-0 opacity-0 -translate-y-full pointer-events-none"
        }`}
      >
        <div className="bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800/60">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 h-11 flex items-center gap-3">

            {/* Back to manga */}
            <Link
              to={`/manga/${mangaId}`}
              className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm flex-shrink-0"
            >
              <ArrowLeftIcon size={16} />
              <span className="hidden sm:inline truncate max-w-[160px]">{manga.title}</span>
              <span className="sm:hidden">Back</span>
            </Link>

            {/* Separator */}
            <span className="text-zinc-700 hidden sm:inline">/</span>

            {/* Chapter name */}
            <span className="text-zinc-300 text-sm font-medium truncate flex-1 text-center sm:text-left">
              {chapterName}
            </span>

            {/* Controls: download + width + prev/next */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={handleDownload}
                title={
                  dlState === "saved" ? "Downloaded — tap to remove"
                  : dlState === "downloading" ? "Downloading…"
                  : "Download for offline"
                }
                className={`p-2 rounded-lg transition-colors ${
                  dlState === "saved" ? "text-orange-400 hover:text-orange-300 hover:bg-zinc-800"
                  : "text-zinc-500 hover:text-white hover:bg-zinc-800"
                }`}
              >
                {dlState === "downloading" ? (
                  <span className="text-[11px] font-semibold tabular-nums">
                    {dlProgress.total ? Math.round((dlProgress.done / dlProgress.total) * 100) : 0}%
                  </span>
                ) : dlState === "saved" ? (
                  <DownloadedGlyph />
                ) : (
                  <DownloadGlyph />
                )}
              </button>

              <button
                onClick={cycleWidth}
                title={WIDTH_LABEL[widthMode]}
                className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                <WidthIcon />
              </button>

              {prevChapter && (
                <Link
                  to={`/manga/${mangaId}/chapter/${prevChapter.id}`}
                  className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                  title={`Previous: Ch. ${chNum(prevChapter.chapterNumber)}`}
                >
                  <ChevronIcon dir="left" />
                </Link>
              )}
              {nextChapter && (
                <Link
                  to={`/manga/${mangaId}/chapter/${nextChapter.id}`}
                  className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                  title={`Next: Ch. ${chNum(nextChapter.chapterNumber)}`}
                >
                  <ChevronIcon dir="right" />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Reading area ──────────────────────────────────────────────────── */}
      {pages.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-zinc-500 px-4">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <p className="text-base font-medium text-center">Pages not available yet.</p>
          <p className="text-sm text-center">
            Suwayomi may still be fetching them — try again in a moment.
          </p>
          <div className="flex gap-3 mt-2">
            <button
              onClick={() => revalidate()}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-400 text-white rounded-lg text-sm transition-colors font-medium"
            >
              Retry
            </button>
            <Link
              to={`/manga/${mangaId}`}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors"
            >
              ← Back to manga
            </Link>
          </div>
        </div>
      ) : (
        <main className="flex flex-col items-center bg-[#0a0a0a] pb-10">
          {pages.map((src, i) => (
            <div
              key={i}
              ref={el => { pageRefs.current[i] = el; }}
              className={`w-full ${WIDTH_CLASS[widthMode]}`}
            >
              <img
                src={src}
                alt={`Page ${i + 1}`}
                loading={i < 3 ? "eager" : "lazy"}
                className="w-full h-auto block select-none"
                style={{ background: "#111" }}
                draggable={false}
              />
            </div>
          ))}

          {/* ── End of chapter ──────────────────────────────────────────── */}
          <div className={`w-full ${WIDTH_CLASS[widthMode]} mt-6 px-4`}>
            <div className="border-t border-zinc-800 pt-6">
              <p className="text-center text-zinc-500 text-sm mb-5 font-medium">
                End of {chapterName}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {prevChapter ? (
                  <Link
                    to={`/manga/${mangaId}/chapter/${prevChapter.id}`}
                    className="group flex items-center gap-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-xl px-4 py-3.5 transition-all"
                  >
                    <ArrowLeftIcon />
                    <div className="min-w-0">
                      <p className="text-[11px] text-zinc-500 uppercase tracking-wide">Previous</p>
                      <p className="text-sm font-medium text-white truncate group-hover:text-orange-400 transition-colors">
                        Ch. {chNum(prevChapter.chapterNumber)}
                        {prevChapter.name && prevChapter.name !== `Chapter ${chNum(prevChapter.chapterNumber)}`
                          ? ` — ${prevChapter.name}`
                          : ""}
                      </p>
                    </div>
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 bg-zinc-900/40 border border-zinc-800/40 rounded-xl px-4 py-3.5">
                    <ArrowLeftIcon />
                    <p className="text-sm text-zinc-600">No previous chapter</p>
                  </div>
                )}

                {nextChapter ? (
                  <Link
                    to={`/manga/${mangaId}/chapter/${nextChapter.id}`}
                    className="group flex items-center justify-between gap-3 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 hover:border-orange-500/40 rounded-xl px-4 py-3.5 transition-all"
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] text-orange-400/70 uppercase tracking-wide">Next</p>
                      <p className="text-sm font-medium text-white truncate group-hover:text-orange-400 transition-colors">
                        Ch. {chNum(nextChapter.chapterNumber)}
                        {nextChapter.name && nextChapter.name !== `Chapter ${chNum(nextChapter.chapterNumber)}`
                          ? ` — ${nextChapter.name}`
                          : ""}
                      </p>
                    </div>
                    <ArrowRightIcon />
                  </Link>
                ) : (
                  <div className="flex items-center justify-between gap-3 bg-zinc-900/40 border border-zinc-800/40 rounded-xl px-4 py-3.5">
                    <p className="text-sm text-zinc-600">No next chapter</p>
                    <ArrowRightIcon />
                  </div>
                )}
              </div>

              <div className="mt-4 text-center">
                <Link
                  to={`/manga/${mangaId}`}
                  className="text-sm text-zinc-500 hover:text-white transition-colors"
                >
                  ← Back to chapter list
                </Link>
              </div>
            </div>
          </div>
        </main>
      )}

      {/* ── Floating page indicator ───────────────────────────────────────── */}
      {pages.length > 0 && (
        <div
          className={`fixed bottom-5 right-4 z-50 transition-all duration-300 ${
            controlsVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"
          }`}
        >
          <div className="bg-zinc-900/90 backdrop-blur-sm border border-zinc-700 text-zinc-300 text-xs font-mono px-3 py-1.5 rounded-full shadow-lg">
            {currentPage} / {pages.length}
          </div>
        </div>
      )}
    </div>
  );
}
