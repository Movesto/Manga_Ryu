import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation, useNavigate, useFetcher, Form } from "react-router";
import type { AuthUser } from "../lib/auth.server";
import { imgUrl } from "../lib/config";
import {
  SearchIcon, XIcon, BookmarkIcon, CompassIcon, HistoryIcon,
  UserIcon, LogOutIcon, ShieldIcon, MenuIcon, CloseIcon,
} from "./icons";
import { MangaRyuLogo, SITE_NAME } from "./Logo";

// ── search overlay ────────────────────────────────────────────────────────────

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const fetcher = useFetcher<{ mangaList: any[]; query: string }>();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (query.trim().length < 3) return;
    const timer = setTimeout(() => {
      fetcher.load(`/search?q=${encodeURIComponent(query.trim())}`);
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  const results = (fetcher.data?.mangaList ?? []).slice(0, 6);
  const searching = fetcher.state === "loading";
  const showDropdown = query.trim().length >= 3;

  const handleSeeAll = () => {
    navigate(`/browse?q=${encodeURIComponent(query.trim())}`);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-zinc-950/90 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-w-2xl mx-auto px-4 pt-16 sm:pt-24">
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none">
            <SearchIcon size={18} />
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
            placeholder="Search manga, manhwa, manhua…"
            className="w-full bg-zinc-900 border border-zinc-700 focus:border-orange-500 rounded-2xl pl-11 pr-12 py-4 text-white placeholder-zinc-500 text-base transition-colors outline-none shadow-2xl"
            onKeyDown={e => { if (e.key === "Escape") onClose(); }}
          />
          <button
            onClick={onClose}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
          >
            <XIcon size={18} />
          </button>
        </div>

        {query.length > 0 && query.trim().length < 3 && (
          <p className="text-zinc-600 text-sm mt-3 text-center">
            Type at least 3 characters to search
          </p>
        )}

        {showDropdown && (
          <div className="mt-2 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
            {searching ? (
              <div className="py-10 text-center text-zinc-500 text-sm">
                <div className="inline-block w-5 h-5 border-2 border-zinc-700 border-t-orange-500 rounded-full animate-spin mb-3" />
                <p>Searching across all sources…</p>
              </div>
            ) : results.length === 0 && fetcher.data ? (
              <div className="py-10 text-center text-zinc-500 text-sm">
                No results found for &ldquo;{query.trim()}&rdquo;
              </div>
            ) : (
              <>
                {results.map((m: any, i: number) => (
                  <Link
                    key={`${m.id}-${i}`}
                    to={`/manga/${m.id}`}
                    onClick={onClose}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 transition-colors border-b border-zinc-800/50 last:border-0"
                  >
                    <img
                      src={imgUrl(m.thumbnailUrl)}
                      alt={m.title}
                      className="w-10 h-[3.75rem] object-cover rounded-lg flex-shrink-0 bg-zinc-800"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-white text-sm font-medium truncate">{m.title}</p>
                      <p className="text-zinc-500 text-xs mt-0.5">{m.sourceName ?? ""}</p>
                    </div>
                    {m.status && (
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                        m.status?.toUpperCase() === "ONGOING"   ? "bg-green-500/20 text-green-400" :
                        m.status?.toUpperCase() === "COMPLETED" ? "bg-blue-500/20 text-blue-400"  :
                        "bg-zinc-700 text-zinc-400"
                      }`}>
                        {m.status?.charAt(0) + m.status?.slice(1).toLowerCase()}
                      </span>
                    )}
                  </Link>
                ))}
                {fetcher.data && (
                  <button
                    onClick={handleSeeAll}
                    className="w-full px-4 py-3.5 text-sm text-orange-400 hover:text-orange-300 hover:bg-zinc-800/60 transition-colors text-center font-medium"
                  >
                    See all results for &ldquo;{query.trim()}&rdquo; →
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── user menu (desktop) ───────────────────────────────────────────────────────

function UserMenu({ user }: { user: AuthUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative ml-2">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-white transition-colors border border-zinc-700"
      >
        <span className="w-6 h-6 rounded-full bg-orange-500 flex items-center justify-center text-xs font-bold flex-shrink-0">
          {user.username[0].toUpperCase()}
        </span>
        <span className="max-w-[100px] truncate">{user.username}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-zinc-800">
            <p className="text-xs text-zinc-500">Signed in as</p>
            <p className="text-sm font-semibold text-white truncate">{user.username}</p>
          </div>
          <Link
            to="/history"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <HistoryIcon size={16} />
            History
          </Link>
          <Link
            to="/library"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <BookmarkIcon size={20} />
            My Bookmarks
          </Link>
          {user.is_admin && (
            <Link
              to="/admin"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm text-orange-400 hover:text-orange-300 hover:bg-zinc-800 transition-colors"
            >
              <ShieldIcon size={16} />
              Admin Panel
            </Link>
          )}
          <Form method="post" action="/signout">
            <button
              type="submit"
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-zinc-300 hover:text-red-400 hover:bg-zinc-800 transition-colors"
            >
              <LogOutIcon />
              Sign Out
            </button>
          </Form>
        </div>
      )}
    </div>
  );
}

// ── nav links ─────────────────────────────────────────────────────────────────

const navLinks = [
  { to: "/browse",   label: "Browse",    icon: <CompassIcon />,  authOnly: false },
  { to: "/history",  label: "History",   icon: <HistoryIcon />,  authOnly: true  },
  { to: "/library",  label: "Bookmarks", icon: <BookmarkIcon />, authOnly: true  },
];

// ── navbar ────────────────────────────────────────────────────────────────────

export default function Navbar({ user }: { user: AuthUser | null }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  const isActive = (path: string) => location.pathname === path;

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(v => !v);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <nav className="sticky top-0 z-50 bg-zinc-950 border-b border-zinc-800 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">

            <Link
              to="/"
              className="flex items-center gap-2 text-white hover:text-orange-400 transition-colors flex-shrink-0"
            >
              <MangaRyuLogo size={26} />
              <span className="font-bold text-lg tracking-tight">{SITE_NAME}</span>
            </Link>

            {/* Desktop nav */}
            <div className="hidden sm:flex items-center gap-1">
              {navLinks.filter(l => !l.authOnly || user).map(({ to, label, icon }) => (
                <Link
                  key={to}
                  to={to}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive(to)
                      ? "text-orange-400 bg-zinc-800"
                      : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                  }`}
                >
                  {icon}
                  {label}
                </Link>
              ))}

              <button
                onClick={() => setSearchOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                aria-label="Search"
              >
                <SearchIcon size={20} />
                <span>Search</span>
                <kbd className="hidden lg:inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 text-[10px] font-mono text-zinc-600 bg-zinc-800 border border-zinc-700 rounded">
                  Ctrl K
                </kbd>
              </button>

              {user ? (
                <UserMenu user={user} />
              ) : (
                <Link
                  to="/signin"
                  className="ml-2 flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white transition-colors"
                >
                  <UserIcon />
                  Sign In
                </Link>
              )}
            </div>

            {/* Mobile: avatar + search + hamburger */}
            <div className="sm:hidden flex items-center gap-0.5">
              {user && (
                <Link to="/library" className="p-1.5 rounded-md" aria-label="My bookmarks">
                  <span className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center text-xs font-bold text-white select-none">
                    {user.username[0].toUpperCase()}
                  </span>
                </Link>
              )}
              <button
                onClick={() => setSearchOpen(true)}
                className="p-2 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                aria-label="Search"
              >
                <SearchIcon size={20} />
              </button>
              <button
                className="p-2 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                onClick={() => setMenuOpen(v => !v)}
                aria-label="Toggle menu"
              >
                {menuOpen ? <CloseIcon /> : <MenuIcon />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile dropdown */}
        {menuOpen && (
          <div className="sm:hidden border-t border-zinc-800 bg-zinc-950 px-4 pb-4 pt-2 flex flex-col gap-1">
            {navLinks.filter(l => !l.authOnly || user).map(({ to, label, icon }) => (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors ${
                  isActive(to)
                    ? "text-orange-400 bg-zinc-800"
                    : "text-zinc-300 hover:text-white hover:bg-zinc-800"
                }`}
              >
                {icon}
                {label}
              </Link>
            ))}
            {user ? (
              <>
                <div className="flex items-center gap-3 px-3 py-2.5 mt-1 rounded-md bg-zinc-900 border border-zinc-800">
                  <span className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                    {user.username[0].toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-zinc-500 leading-none">Signed in as</p>
                    <p className="text-sm font-semibold text-white truncate mt-0.5">{user.username}</p>
                  </div>
                </div>
                {user.is_admin && (
                  <Link
                    to="/admin"
                    className="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-orange-400 hover:text-orange-300 hover:bg-zinc-800 transition-colors"
                  >
                    <ShieldIcon size={16} />
                    Admin Panel
                  </Link>
                )}
                <Form method="post" action="/signout">
                  <button
                    type="submit"
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                  >
                    <LogOutIcon />
                    Sign Out
                  </button>
                </Form>
              </>
            ) : (
              <Link
                to="/signin"
                className="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-semibold text-white bg-orange-500 hover:bg-orange-400 transition-colors mt-1"
              >
                <UserIcon />
                Sign In
              </Link>
            )}
          </div>
        )}
      </nav>

      {searchOpen && <SearchOverlay onClose={closeSearch} />}
    </>
  );
}
