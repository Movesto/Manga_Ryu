import { useMemo, useState } from "react";
import { redirect, useLoaderData, useFetcher, useRouteLoaderData, Link, data } from "react-router";
import type { Route } from "./+types/admin.extensions";
import { getSession, sessionHeaders } from "../lib/auth.server";
import { verifyCsrf } from "../lib/csrf.server";
import { API, imgUrl } from "../lib/config";
import { SearchIcon, PlusIcon, TrashIcon, ShieldIcon } from "../components/icons";

interface Extension {
  pkgName: string;
  name: string;
  lang: string;
  versionName: string;
  iconUrl: string;
  isInstalled: boolean;
  isObsolete: boolean;
  hasUpdate: boolean;
  isNsfw: boolean;
  repo: string | null;
}

// ── loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSession(request);
  const { user, token } = session;
  if (!user) throw redirect("/signin?next=/admin/extensions");
  if (!user.is_admin) throw redirect("/");

  let extensions: Extension[] = [];
  let error: string | null = null;
  try {
    const res = await fetch(`${API}/api/admin/extensions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const d = await res.json();
      extensions = (d.extensions ?? []) as Extension[];
    } else {
      error = `Couldn't load extensions from Suwayomi (HTTP ${res.status}).`;
    }
  } catch {
    error = "Couldn't reach the backend.";
  }

  return data({ user, extensions, error }, { headers: sessionHeaders(session) });
}

// ── action ────────────────────────────────────────────────────────────────────

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  if (!verifyCsrf(request, form.get("csrf_token") as string | null)) {
    throw new Response("Invalid CSRF token", { status: 403 });
  }

  const { token } = await getSession(request);
  if (!token) return { error: "Not authenticated" };

  const intent = form.get("intent") as string;
  const pkg = form.get("pkg_name") as string;
  const headers = { Authorization: `Bearer ${token}` };

  try {
    if (intent === "refresh") {
      const r = await fetch(`${API}/api/admin/extensions/refresh`, { method: "POST", headers });
      return r.ok ? { ok: true } : { error: "Refresh failed — is Suwayomi reachable?" };
    }
    if (intent === "sync") {
      const r = await fetch(`${API}/api/sync`, { method: "POST", headers });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) return { error: "Sync could not start." };
      return { ok: true, sync: body.status ?? "started" };
    }
    if (intent === "install" || intent === "uninstall") {
      const r = await fetch(
        `${API}/api/admin/extensions/${encodeURIComponent(pkg)}/${intent}`,
        { method: "POST", headers },
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        return { error: body.detail ? String(body.detail) : `${intent} failed` };
      }
      return { ok: true };
    }
  } catch {
    return { error: "Backend unreachable." };
  }
  return { error: "Unknown action" };
}

// ── language label helper ──────────────────────────────────────────────────────

const LANG_NAMES: Record<string, string> = {
  all: "Multi", en: "English", es: "Spanish", "es-419": "Spanish (LatAm)",
  fr: "French", de: "German", it: "Italian", pt: "Portuguese",
  "pt-br": "Portuguese (BR)", ru: "Russian", ja: "Japanese", ko: "Korean",
  zh: "Chinese", "zh-hans": "Chinese (Simpl.)", "zh-hant": "Chinese (Trad.)",
  id: "Indonesian", ar: "Arabic", tr: "Turkish", vi: "Vietnamese", th: "Thai",
};
const langLabel = (l: string) => LANG_NAMES[l?.toLowerCase()] ?? (l || "—").toUpperCase();

// ── extension row ──────────────────────────────────────────────────────────────

function ExtensionRow({ ext }: { ext: Extension }) {
  const { csrf } = useRouteLoaderData("root") as { csrf: string };
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const busy = fetcher.state !== "idle";

  const act = (intent: "install" | "uninstall") =>
    fetcher.submit({ intent, pkg_name: ext.pkgName, csrf_token: csrf }, { method: "post" });

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/60 last:border-0">
      <img
        src={ext.iconUrl ? imgUrl(ext.iconUrl) : ""}
        alt=""
        onError={(e) => { (e.currentTarget.style.visibility = "hidden"); }}
        className="w-9 h-9 rounded-lg object-contain bg-zinc-800 flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-white text-sm font-medium truncate">{ext.name}</p>
          {ext.isNsfw && (
            <span className="text-[10px] font-bold text-red-400 border border-red-500/40 rounded px-1 py-px flex-shrink-0">18+</span>
          )}
          {ext.isObsolete && (
            <span className="text-[10px] font-bold text-amber-400 border border-amber-500/40 rounded px-1 py-px flex-shrink-0">OBSOLETE</span>
          )}
        </div>
        <p className="text-zinc-500 text-xs truncate">
          {langLabel(ext.lang)} · v{ext.versionName}
        </p>
      </div>

      {fetcher.data?.error && (
        <span className="text-xs text-red-400 mr-1 hidden sm:inline">{fetcher.data.error}</span>
      )}

      {ext.isInstalled ? (
        <button
          onClick={() => act("uninstall")}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 bg-zinc-800 hover:bg-red-500/15 hover:text-red-400 text-zinc-300 border border-zinc-700 transition-colors disabled:opacity-50"
        >
          {busy ? <Spinner /> : <TrashIcon />}
          Uninstall
        </button>
      ) : (
        <button
          onClick={() => act("install")}
          disabled={busy || ext.isObsolete}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 bg-orange-500 hover:bg-orange-400 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? <Spinner /> : <PlusIcon />}
          Install
        </button>
      )}
    </div>
  );
}

function Spinner() {
  return <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />;
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function AdminExtensionsPage() {
  const { extensions, error } = useLoaderData<typeof loader>();
  const { csrf } = useRouteLoaderData("root") as { csrf: string };
  const bar = useFetcher<{ ok?: boolean; error?: string; sync?: string }>();
  const barBusy = bar.state !== "idle";
  const barIntent = barBusy ? (bar.formData?.get("intent") as string) : null;

  const [q, setQ] = useState("");
  const [lang, setLang] = useState("");
  const [installedOnly, setInstalledOnly] = useState(false);

  const langs = useMemo(() => {
    const s = new Set(extensions.map((e) => e.lang).filter(Boolean));
    return Array.from(s).sort();
  }, [extensions]);

  const installedCount = extensions.filter((e) => e.isInstalled).length;

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return extensions.filter((e) => {
      if (installedOnly && !e.isInstalled) return false;
      if (lang && e.lang !== lang) return false;
      if (query && !e.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [extensions, q, lang, installedOnly]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">

        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <span className="text-orange-400"><ShieldIcon /></span>
          <h1 className="text-2xl font-bold text-white">Extensions</h1>
        </div>
        <p className="text-zinc-500 text-sm mb-6">
          Install source extensions, then run a sync to pull their manga into the catalog.
        </p>

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <button
            onClick={() => bar.submit({ intent: "refresh", csrf_token: csrf }, { method: "post" })}
            disabled={barBusy}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-white transition-colors disabled:opacity-50"
          >
            {barBusy && barIntent === "refresh" ? <Spinner /> : null}
            Refresh catalog
          </button>
          <button
            onClick={() => bar.submit({ intent: "sync", csrf_token: csrf }, { method: "post" })}
            disabled={barBusy}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white transition-colors disabled:opacity-50"
          >
            {barBusy && barIntent === "sync" ? <Spinner /> : null}
            Sync catalog now
          </button>
          <span className="text-xs text-zinc-500 ml-auto">
            {installedCount} installed · {extensions.length} available
          </span>
        </div>

        {bar.data?.error && (
          <p className="text-sm text-red-400 mb-4">{bar.data.error}</p>
        )}
        {bar.data?.ok && barIntent == null && (
          <p className="text-sm text-emerald-400 mb-4">
            {bar.data.sync ? `Sync ${bar.data.sync}. New manga will appear as it runs.` : "Done."}
          </p>
        )}

        {error ? (
          <div className="py-12 text-center border border-dashed border-zinc-700 rounded-xl">
            <p className="text-red-400 text-sm">{error}</p>
            <p className="text-zinc-600 text-xs mt-1">
              Make sure the Suwayomi service is up and an extension repo is configured.
            </p>
          </div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 p-4 border-b border-zinc-800">
              <div className="relative flex-1 min-w-[180px]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none">
                  <SearchIcon size={16} />
                </span>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search extensions…"
                  className="w-full bg-zinc-950 border border-zinc-700 focus:border-orange-500 rounded-xl pl-9 pr-3 py-2 text-white placeholder-zinc-500 text-sm outline-none transition-colors"
                />
              </div>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                className="bg-zinc-950 border border-zinc-700 focus:border-orange-500 rounded-xl px-3 py-2 text-sm text-white outline-none"
              >
                <option value="">All languages</option>
                {langs.map((l) => (
                  <option key={l} value={l}>{langLabel(l)}</option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={installedOnly}
                  onChange={(e) => setInstalledOnly(e.target.checked)}
                  className="accent-orange-500 w-4 h-4"
                />
                Installed only
              </label>
            </div>

            {/* List */}
            {filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-zinc-500">
                {extensions.length === 0
                  ? "No extensions found. Click “Refresh catalog” to pull them from your repo."
                  : "No extensions match your filters."}
              </p>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto">
                {filtered.map((ext) => (
                  <ExtensionRow key={ext.pkgName} ext={ext} />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="pt-6">
          <Link to="/admin" className="text-sm text-zinc-500 hover:text-white transition-colors">
            ← Back to admin
          </Link>
        </div>
      </div>
    </div>
  );
}
