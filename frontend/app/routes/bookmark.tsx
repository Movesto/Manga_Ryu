import type { Route } from "./+types/bookmark";
import { API } from "../lib/config";
import { getSession } from "../lib/auth.server";
import { verifyCsrf } from "../lib/csrf.server";

export async function action({ request }: Route.ActionArgs) {
  const { token } = await getSession(request);
  if (!token) return { bookmarked: false, error: "Not authenticated" };

  const form    = await request.formData();
  const submitted = form.get("csrf_token") as string | null;
  if (!verifyCsrf(request, submitted)) {
    throw new Response("Invalid CSRF token", { status: 403 });
  }

  const mangaId = form.get("manga_id") as string;
  const intent  = form.get("intent") as string;

  const method = intent === "remove" ? "DELETE" : "POST";
  const res = await fetch(`${API}/api/bookmarks/${mangaId}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);

  if (!res?.ok) return { bookmarked: intent !== "remove", error: "Request failed" };
  return await res.json();
}
