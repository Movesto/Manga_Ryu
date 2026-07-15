import { useState, useEffect, useRef } from "react";
import { useLoaderData, useRouteLoaderData, Link } from "react-router";
import { data } from "react-router";
import type { AuthUser } from "../lib/auth.server";
import { getSession, sessionHeaders } from "../lib/auth.server";
import { API, imgUrl } from "../lib/config";
import { chNum } from "../lib/utils";
import { ChevronIcon, PlayIcon } from "../components/icons";
import { MangaCard } from "../components/MangaCard";

export async function loader({ request }: { request: Request }) {
  const session = await getSession(request);
  const token = session.user ? session.token : null;

  const fetches: Promise<Response>[] = [
    fetch(`${API}/api/popular`),
    fetch(`${API}/api/latest`),
    fetch(`${API}/api/completed`),
    fetch(`${API}/api/new`),
    fetch(`${API}/api/editors-choice`),
  ];
  if (token) {
    fetches.push(fetch(`${API}/api/history?limit=12`, {
      headers: { Authorization: `Bearer ${token}` },
    }));
  }

  const responses = await Promise.all(fetches.map(f => f.catch(() => null)));
  const [popularData, latestData, completedData, newData, editorsData, historyData] =
    await Promise.all(responses.map(r => r?.json().catch(() => ({}))));

  const allPopular:   any[] = popularData?.mangaList   || [];
  const allLatest:    any[] = latestData?.mangaList    || [];
  const allCompleted: any[] = completedData?.mangaList || [];
  const allNew:       any[] = newData?.mangaList       || [];
  const editorsPick:  any[] = editorsData?.mangaList   || [];
  const continueReading: any[] = historyData?.history  || [];

  return data({
    sliderManga: allPopular.slice(0, 12),
    editorsPick,
    latest:         allLatest.slice(0, 12),
    completed:      allCompleted.slice(0, 18),
    newSeries:      allNew.slice(0, 24),
    continueReading,
  }, { headers: sessionHeaders(session) });
}

// ─── constants ────────────────────────────────────────────────────────────────
const COVER_W = 148;
const COVER_H = 212;
const GAP     = 8;
const STEP    = COVER_W + GAP;

// ─── HeroSlider (infinite loop via tripled array) ─────────────────────────────
function HeroSlider({ manga }: { manga: any[] }) {
  const N       = manga.length;
  const tripled = [...manga, ...manga, ...manga];

  // trackIdx lives in the middle copy [N, 2N). We silently reset when it
  // drifts outside that window after a transition ends.
  const [trackIdx, setTrackIdx] = useState(N);
  const [animated, setAnimated] = useState(true);
  const trackIdxRef = useRef(N);
  useEffect(() => {
    trackIdxRef.current = trackIdx;
  }, [trackIdx]);

  const sectionRef = useRef<HTMLElement>(null);
  const [cw, setCw]   = useState(900);

  // Measure container width, update on resize
  useEffect(() => {
    const update = () => { if (sectionRef.current) setCw(sectionRef.current.offsetWidth); };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Auto-advance
  useEffect(() => {
    if (N <= 1) return;
    const id = setInterval(() => setTrackIdx(i => i + 1), 5000);
    return () => clearInterval(id);
  }, [N]);

  // Re-enable animation on the next two frames after a silent position reset
  useEffect(() => {
    if (animated) return;
    let id1: number;
    const id0 = requestAnimationFrame(() => {
      id1 = requestAnimationFrame(() => setAnimated(true));
    });
    return () => { cancelAnimationFrame(id0); cancelAnimationFrame(id1); };
  }, [animated]);

  if (N === 0) return null;

  const activeLogical = ((trackIdx % N) + N) % N;
  const cur     = manga[activeLogical];
  const trackX  = cw / 2 - COVER_W / 2 - trackIdx * STEP;

  const goTo = (delta: number) => setTrackIdx(i => i + delta);

  // After the CSS transition ends on the TRACK element (not children), silently
  // jump back to the identical position in the middle copy.
  const onTrackTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // ignore bubbled child events
    const t = trackIdxRef.current;
    if (t >= 2 * N) { setAnimated(false); setTrackIdx(t - N); }
    else if (t < N) { setAnimated(false); setTrackIdx(t + N); }
  };

  // Jump to whichever copy of a cover is closest to the current position
  const jumpTo = (logicalIdx: number) => {
    const candidates = [logicalIdx, logicalIdx + N, logicalIdx + 2 * N];
    const closest = candidates.reduce((a, b) =>
      Math.abs(a - trackIdxRef.current) <= Math.abs(b - trackIdxRef.current) ? a : b,
    );
    setTrackIdx(closest);
  };

  const INFO_H = 68; // height of the bottom info bar in px

  return (
    <section
      ref={sectionRef}
      className="relative w-full overflow-hidden bg-zinc-950"
      style={{ height: `${COVER_H + INFO_H}px` }}
    >
      {/* Blurred backdrop covers the full section */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${imgUrl(cur.thumbnailUrl)})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(32px) brightness(0.18)",
          transform: "scale(1.12)",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/30 via-transparent to-zinc-950" />

      {/* Section label */}
      <div className="absolute top-4 left-4 sm:left-6 z-20">
        <span className="text-xs font-bold text-orange-400 uppercase tracking-widest">
          🔥 Popular
        </span>
      </div>

      {/* Filmstrip — strictly confined to the cover area, never bleeds into the info bar */}
      <div
        className="absolute left-0 right-0 overflow-hidden"
        style={{ top: 0, height: `${COVER_H}px` }}
      >
        <div
          className="flex items-center h-full"
          style={{
            transform: `translateX(${trackX}px)`,
            transition: animated ? "transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)" : "none",
            gap: `${GAP}px`,
          }}
          onTransitionEnd={onTrackTransitionEnd}
        >
          {tripled.map((m, idx) => {
            const isActive = idx === trackIdx;
            return (
              <Link
                key={idx}
                to={`/manga/${m.id}`}
                onClick={(e) => {
                  if (!isActive) { e.preventDefault(); jumpTo(idx % N); }
                }}
                style={{
                  width: `${COVER_W}px`,
                  flexShrink: 0,
                  cursor: "pointer",
                  transform: isActive ? "scale(1.07)" : "scale(0.90)",
                  opacity:   isActive ? 1 : 0.45,
                  transition: "transform 0.4s ease, opacity 0.4s ease",
                  display: "block",
                }}
              >
                <div className="relative">
                  <img
                    src={imgUrl(m.thumbnailUrl)}
                    alt={m.title}
                    draggable={false}
                    style={{
                      width: `${COVER_W}px`,
                      height: `${COVER_H}px`,
                      objectFit: "cover",
                      borderRadius: "8px",
                      display: "block",
                    }}
                  />
                  {isActive && (
                    <div style={{
                      position: "absolute", inset: 0, borderRadius: "8px",
                      boxShadow: "0 0 0 2px rgb(251,146,60), 0 16px 48px rgba(0,0,0,0.75)",
                    }} />
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Prev / Next arrows — anchored to the cover area */}
      <button
        onClick={() => goTo(-1)}
        className="absolute left-3 sm:left-5 z-20 w-9 h-9 flex items-center justify-center rounded-full bg-zinc-900/80 hover:bg-orange-500 text-white transition-colors"
        style={{ top: `${Math.round(COVER_H / 2) - 18}px` }}
        aria-label="Previous"
      >
        <ChevronIcon dir="left" />
      </button>
      <button
        onClick={() => goTo(1)}
        className="absolute right-3 sm:right-5 z-20 w-9 h-9 flex items-center justify-center rounded-full bg-zinc-900/80 hover:bg-orange-500 text-white transition-colors"
        style={{ top: `${Math.round(COVER_H / 2) - 18}px` }}
        aria-label="Next"
      >
        <ChevronIcon dir="right" />
      </button>

      {/* Info bar — sits below the filmstrip, never overlaps covers */}
      <div
        className="absolute left-0 right-0 z-20 flex flex-col items-center justify-center gap-2 px-6"
        style={{ top: `${COVER_H}px`, height: `${INFO_H}px` }}
      >
        <p className="text-white text-sm font-semibold drop-shadow max-w-xs sm:max-w-md text-center truncate w-full">
          {cur.title}
        </p>
        <div className="flex items-center gap-1.5">
          {manga.map((_, i) => (
            <button
              key={i}
              onClick={() => jumpTo(i)}
              aria-label={`Slide ${i + 1}`}
              style={{
                width:           i === activeLogical ? "16px" : "6px",
                height:          "6px",
                borderRadius:    "9999px",
                backgroundColor: i === activeLogical ? "rgb(251,146,60)" : "rgb(82,82,91)",
                transition:      "all 0.3s ease",
                border:          "none",
                padding:         0,
                cursor:          "pointer",
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Continue Reading ─────────────────────────────────────────────────────────

function ContinueReading({ items }: { items: any[] }) {
  if (items.length === 0) return null;
  return (
    <section className="w-full px-4 sm:px-6 py-6 border-b border-zinc-800/40">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-white tracking-wide">Continue Reading</h2>
        <Link
          to="/history"
          className="flex items-center gap-1 text-sm text-zinc-400 hover:text-orange-400 transition-colors"
        >
          View All
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {items.map((item: any) => (
          <Link
            key={item.mangaId}
            to={`/manga/${item.mangaId}/chapter/${item.lastChapterId}`}
            className="flex-shrink-0 w-[110px] group"
          >
            <div className="relative rounded-xl overflow-hidden bg-zinc-800 mb-2" style={{ aspectRatio: "2/3" }}>
              <img
                src={imgUrl(item.mangaThumbnail)}
                alt={item.mangaTitle}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
              <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                <span className="text-[10px] font-semibold text-orange-400 bg-zinc-900/90 px-2 py-0.5 rounded-full">
                  Ch. {item.lastChapterNumber != null ? chNum(item.lastChapterNumber) : "?"}
                </span>
              </div>
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="w-9 h-9 bg-orange-500/90 rounded-full flex items-center justify-center">
                  <PlayIcon size={14} />
                </div>
              </div>
            </div>
            <p className="text-white text-[11px] font-medium line-clamp-2 group-hover:text-orange-400 transition-colors leading-snug">
              {item.mangaTitle}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ─── Home section grid (Latest, Completed, New Series) ───────────────────────
function MangaGrid({
  title,
  manga,
  viewAllHref,
  hoverColor = "text-orange-400",
}: {
  title: string;
  manga: any[];
  viewAllHref?: string;
  hoverColor?: string;
}) {
  if (manga.length === 0) return null;
  return (
    <section className="w-full px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-bold text-white tracking-wide">{title}</h2>
        {viewAllHref && (
          <Link
            to={viewAllHref}
            className="flex items-center gap-1 text-sm text-zinc-400 hover:text-orange-400 transition-colors"
          >
            View All
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3 sm:gap-4">
        {manga.map((m: any, idx: number) => (
          <MangaCard key={`${m.id}-${idx}`} manga={m} hoverColor={hoverColor} showChapterRows />
        ))}
      </div>
    </section>
  );
}

// ─── Editor's Pick — auto-advancing filmstrip (no user controls) ──────────────
const EC_W    = COVER_W;
const EC_H    = COVER_H;
const EC_GAP  = GAP;
const EC_STEP = EC_W + EC_GAP;

function EditorsPick({ manga, isAdmin }: { manga: any[]; isAdmin: boolean }) {
  const N = manga.length;

  // Empty state — only shown to admin
  if (N === 0) {
    if (!isAdmin) return null;
    return (
      <section className="w-full px-4 sm:px-6 py-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-yellow-400 text-base">⭐</span>
          <h2 className="text-base font-bold text-white tracking-wide">Editor's Pick</h2>
          <Link
            to="/admin"
            className="ml-auto flex items-center gap-1 text-sm text-zinc-400 hover:text-yellow-400 transition-colors"
          >
            Manage
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Link>
        </div>
        <div className="py-12 border border-dashed border-zinc-800 rounded-xl text-center">
          <p className="text-zinc-500 text-sm">No picks yet</p>
          <Link to="/admin" className="text-xs text-orange-400 hover:text-orange-300 mt-1 inline-block transition-colors">
            Add some from the Admin Panel →
          </Link>
        </div>
      </section>
    );
  }

  return <EditorsPickCarousel manga={manga} isAdmin={isAdmin} />;
}

function EditorsPickCarousel({ manga, isAdmin }: { manga: any[]; isAdmin: boolean }) {
  const N = manga.length;
  const tripled = [...manga, ...manga, ...manga];
  const [trackIdx, setTrackIdx]   = useState(N);
  const [animated, setAnimated]   = useState(true);
  const trackIdxRef               = useRef(N);
  useEffect(() => {
    trackIdxRef.current = trackIdx;
  }, [trackIdx]);
  const sectionRef                = useRef<HTMLElement>(null);
  const [cw, setCw]               = useState(900);

  useEffect(() => {
    const update = () => { if (sectionRef.current) setCw(sectionRef.current.offsetWidth); };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Auto-advance only — no user arrow controls
  useEffect(() => {
    if (N <= 1) return;
    const id = setInterval(() => setTrackIdx(i => i + 1), 3500);
    return () => clearInterval(id);
  }, [N]);

  useEffect(() => {
    if (animated) return;
    let id1: number;
    const id0 = requestAnimationFrame(() => {
      id1 = requestAnimationFrame(() => setAnimated(true));
    });
    return () => { cancelAnimationFrame(id0); cancelAnimationFrame(id1); };
  }, [animated]);

  const onTrackTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const t = trackIdxRef.current;
    if (t >= 2 * N) { setAnimated(false); setTrackIdx(t - N); }
    else if (t < N) { setAnimated(false); setTrackIdx(t + N); }
  };

  const activeLogical = ((trackIdx % N) + N) % N;
  const cur    = manga[activeLogical];
  const trackX = cw / 2 - EC_W / 2 - trackIdx * EC_STEP;

  return (
    <section
      ref={sectionRef}
      className="relative w-full overflow-hidden bg-zinc-950"
      style={{ height: `${EC_H + 88}px` }}
    >
      {/* Blurred gold-tinted backdrop */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${imgUrl(cur.thumbnailUrl)})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(32px) brightness(0.18)",
          transform: "scale(1.12)",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/30 via-transparent to-zinc-950" />

      {/* Section label + optional manage link */}
      <div className="absolute top-4 left-4 sm:left-6 z-20 flex items-center gap-3">
        <span className="text-xs font-bold text-yellow-400 uppercase tracking-widest">
          ⭐ Editor's Pick
        </span>
        {isAdmin && (
          <Link
            to="/admin"
            className="text-[10px] text-zinc-500 hover:text-yellow-400 transition-colors"
          >
            Manage →
          </Link>
        )}
      </div>

      {/* Filmstrip — strictly confined to the cover area */}
      <div
        className="absolute left-0 right-0 overflow-hidden"
        style={{ top: 0, height: `${EC_H}px` }}
      >
        <div
          className="flex items-center h-full"
          style={{
            transform: `translateX(${trackX}px)`,
            transition: animated ? "transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)" : "none",
            gap: `${EC_GAP}px`,
          }}
          onTransitionEnd={onTrackTransitionEnd}
        >
          {tripled.map((m, idx) => {
            const isActive = idx === trackIdx;
            return (
              <Link
                key={idx}
                to={`/manga/${m.id}`}
                style={{
                  width: `${EC_W}px`,
                  flexShrink: 0,
                  transform: isActive ? "scale(1.07)" : "scale(0.90)",
                  opacity:   isActive ? 1 : 0.45,
                  transition: "transform 0.4s ease, opacity 0.4s ease",
                  display: "block",
                }}
              >
                <div className="relative">
                  <img
                    src={imgUrl(m.thumbnailUrl)}
                    alt={m.title}
                    draggable={false}
                    style={{
                      width: `${EC_W}px`,
                      height: `${EC_H}px`,
                      objectFit: "cover",
                      borderRadius: "8px",
                      display: "block",
                    }}
                  />
                  {isActive && (
                    <>
                      <div style={{ position: "absolute", top: "8px", left: "8px" }}>
                        <span className="text-[9px] font-extrabold bg-yellow-400 text-zinc-900 px-1.5 py-0.5 rounded uppercase tracking-wide leading-none">
                          Pick
                        </span>
                      </div>
                      <div style={{
                        position: "absolute", inset: 0, borderRadius: "8px",
                        boxShadow: "0 0 0 2px rgb(234,179,8), 0 16px 48px rgba(0,0,0,0.75)",
                      }} />
                    </>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Info bar — sits below the filmstrip, never overlaps covers */}
      <div
        className="absolute left-0 right-0 z-20 flex flex-col items-center justify-center gap-2 px-6"
        style={{ top: `${EC_H}px`, height: "88px" }}
      >
        <p className="text-white text-sm font-semibold drop-shadow max-w-xs sm:max-w-md text-center px-6 truncate">
          {cur.title}
        </p>
        <div className="flex items-center gap-1.5">
          {manga.map((_, i) => (
            <div
              key={i}
              style={{
                width:           i === activeLogical ? "16px" : "6px",
                height:          "6px",
                borderRadius:    "9999px",
                backgroundColor: i === activeLogical ? "rgb(234,179,8)" : "rgb(82,82,91)",
                transition:      "all 0.3s ease",
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const { sliderManga, editorsPick, latest, completed, newSeries, continueReading } =
    useLoaderData<typeof loader>();
  const rootData = useRouteLoaderData("root") as { user: AuthUser | null } | undefined;
  const isAdmin  = rootData?.user?.is_admin ?? false;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <HeroSlider manga={sliderManga} />
      <ContinueReading items={continueReading} />
      <MangaGrid title="Latest Updates"   manga={latest}     viewAllHref="/latest" />
      <EditorsPick                         manga={editorsPick} isAdmin={isAdmin} />
      <MangaGrid title="Completed Series" manga={completed}   viewAllHref="/completed" hoverColor="text-blue-400" />
      <MangaGrid title="New Series"       manga={newSeries}   hoverColor="text-green-400" />
    </div>
  );
}
