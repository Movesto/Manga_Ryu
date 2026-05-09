import { useState } from "react";
import { redirect, useActionData, useNavigation, Link, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/signin";
import { getUser, authCookieHeaders } from "../lib/auth.server";
import { verifyCsrf } from "../lib/csrf.server";
import { API } from "../lib/config";
import { MangaRyuLogo, SITE_NAME } from "../components/Logo";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  if (user) throw redirect("/library");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const submitted = form.get("csrf_token") as string | null;
  if (!verifyCsrf(request, submitted)) {
    throw new Response("Invalid CSRF token", { status: 403 });
  }

  const intent = form.get("intent") as string;

  if (intent === "login") {
    const body = new URLSearchParams({
      username: form.get("username") as string,
      password: form.get("password") as string,
    });
    const res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { error: err.detail ?? "Incorrect username or password", intent };
    }
    const { access_token, refresh_token } = await res.json();
    const headers = new Headers();
    for (const [k, v] of authCookieHeaders(access_token, refresh_token)) {
      headers.append(k, v);
    }
    // Only allow same-origin relative paths; reject absolute URLs and protocol-relative URLs
    const raw  = new URL(request.url).searchParams.get("next") ?? "";
    const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/library";
    throw redirect(next, { headers });
  }

  if (intent === "register") {
    const res = await fetch(`${API}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        email: form.get("email"),
        password: form.get("password"),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { error: err.detail ?? "Registration failed", intent };
    }
    const { access_token, refresh_token } = await res.json();
    const headers = new Headers();
    for (const [k, v] of authCookieHeaders(access_token, refresh_token)) {
      headers.append(k, v);
    }
    throw redirect("/library", { headers });
  }

  return { error: "Unknown request", intent: "" };
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function SignIn() {
  const [tab, setTab] = useState<"login" | "register">("login");
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const { csrf } = useRouteLoaderData("root") as { csrf: string };

  const error = actionData?.error;
  const errorTab = actionData?.intent;

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 hover:opacity-80 transition-opacity">
            <MangaRyuLogo size={32} />
            <span className="text-xl font-bold text-white">{SITE_NAME}</span>
          </Link>
          <p className="text-zinc-500 text-sm mt-2">
            {tab === "login" ? "Sign in to your account" : "Create your account"}
          </p>
        </div>

        {/* Card */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl">

          {/* Tabs */}
          <div className="flex bg-zinc-800 rounded-xl p-1 mb-6">
            {(["login", "register"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                  tab === t
                    ? "bg-zinc-700 text-white shadow"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>

          {/* Error */}
          {error && errorTab === tab && (
            <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Login form */}
          {tab === "login" && (
            <form method="post" className="flex flex-col gap-4">
              <input type="hidden" name="intent" value="login" />
              <input type="hidden" name="csrf_token" value={csrf} />
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Username</label>
                <input
                  name="username"
                  type="text"
                  required
                  autoComplete="username"
                  className="w-full bg-zinc-800 border border-zinc-700 focus:border-orange-500 rounded-xl px-4 py-2.5 text-white placeholder-zinc-600 text-sm outline-none transition-colors"
                  placeholder="your_username"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Password</label>
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="w-full bg-zinc-800 border border-zinc-700 focus:border-orange-500 rounded-xl px-4 py-2.5 text-white placeholder-zinc-600 text-sm outline-none transition-colors"
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl transition-colors mt-1"
              >
                {submitting ? "Signing in…" : "Sign In"}
              </button>
            </form>
          )}

          {/* Register form */}
          {tab === "register" && (
            <form method="post" className="flex flex-col gap-4">
              <input type="hidden" name="intent" value="register" />
              <input type="hidden" name="csrf_token" value={csrf} />
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Username</label>
                <input
                  name="username"
                  type="text"
                  required
                  minLength={2}
                  autoComplete="username"
                  className="w-full bg-zinc-800 border border-zinc-700 focus:border-orange-500 rounded-xl px-4 py-2.5 text-white placeholder-zinc-600 text-sm outline-none transition-colors"
                  placeholder="your_username"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email</label>
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="w-full bg-zinc-800 border border-zinc-700 focus:border-orange-500 rounded-xl px-4 py-2.5 text-white placeholder-zinc-600 text-sm outline-none transition-colors"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Password</label>
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="w-full bg-zinc-800 border border-zinc-700 focus:border-orange-500 rounded-xl px-4 py-2.5 text-white placeholder-zinc-600 text-sm outline-none transition-colors"
                  placeholder="Min 8 characters"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl transition-colors mt-1"
              >
                {submitting ? "Creating account…" : "Create Account"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
