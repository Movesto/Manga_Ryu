import { Link } from "react-router";
import { imgUrl } from "../lib/config";
import { relativeTime, chNum } from "../lib/utils";

export interface Manga {
  id: number;
  title: string;
  thumbnailUrl: string;
  sourceName?: string;
  status?: string;
  chapterCount?: number;
  recentChapters?: { chapterNumber: number; uploadDate?: number }[];
}

// ── ChapterRows ───────────────────────────────────────────────────────────────

export function ChapterRows({ chapters }: { chapters: { chapterNumber: number; uploadDate?: number }[] }) {
  if (!chapters?.length) return null;
  return (
    <div className="flex flex-col gap-0.5 mt-1.5">
      {chapters.slice(0, 2).map((ch, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[10px] leading-none">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
          <span className="text-zinc-300 font-medium">Ch. {chNum(ch.chapterNumber)}</span>
          <span className="text-zinc-600">•</span>
          <span className="text-zinc-500">{relativeTime(ch.uploadDate ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}

// ── MangaCard ─────────────────────────────────────────────────────────────────

export function MangaCard({
  manga,
  hoverColor = "text-orange-400",
  showStatus = false,
  showComplete = false,
  showChapterRows = false,
}: {
  manga: Manga;
  hoverColor?: string;
  showStatus?: boolean;
  showComplete?: boolean;
  showChapterRows?: boolean;
}) {
  return (
    <Link to={`/manga/${manga.id}`} className="group flex flex-col">
      <div className="relative rounded-lg overflow-hidden mb-2 bg-zinc-800" style={{ aspectRatio: "2/3" }}>
        <img
          src={imgUrl(manga.thumbnailUrl)}
          alt={manga.title}
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        {manga.sourceName && (
          <div className="absolute top-1.5 left-1.5">
            <span className="text-[9px] font-semibold bg-zinc-900/85 text-zinc-300 px-1.5 py-0.5 rounded leading-none">
              {manga.sourceName}
            </span>
          </div>
        )}
        {showComplete && (
          <div className="absolute top-1.5 right-1.5">
            <span className="text-[9px] font-bold bg-blue-500/75 text-white px-1.5 py-0.5 rounded leading-none">
              Complete
            </span>
          </div>
        )}
        {showStatus && manga.status && manga.status !== "UNKNOWN" && (
          <div className="absolute top-1.5 right-1.5">
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded leading-none ${
              manga.status === "ONGOING"   ? "bg-green-500/80 text-white" :
              manga.status === "COMPLETED" ? "bg-blue-500/80 text-white"  :
              "bg-zinc-700/80 text-zinc-300"
            }`}>
              {manga.status.charAt(0) + manga.status.slice(1).toLowerCase()}
            </span>
          </div>
        )}
      </div>
      <p className={`text-white text-xs font-medium leading-snug line-clamp-2 transition-colors group-hover:${hoverColor}`}>
        {manga.title}
      </p>
      {showChapterRows && manga.recentChapters && (
        <ChapterRows chapters={manga.recentChapters} />
      )}
      {showComplete && (manga.chapterCount ?? 0) > 0 && (
        <p className="text-zinc-600 text-[10px] mt-0.5">{manga.chapterCount} chapters</p>
      )}
    </Link>
  );
}

// ── MangaGrid ─────────────────────────────────────────────────────────────────

const DEFAULT_GRID = "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4";

export function MangaGrid({
  manga,
  gridClass = DEFAULT_GRID,
  ...cardProps
}: {
  manga: Manga[];
  gridClass?: string;
  hoverColor?: string;
  showStatus?: boolean;
  showComplete?: boolean;
  showChapterRows?: boolean;
}) {
  return (
    <div className={gridClass}>
      {manga.map((m, idx) => (
        <MangaCard key={`${m.id}-${idx}`} manga={m} {...cardProps} />
      ))}
    </div>
  );
}
