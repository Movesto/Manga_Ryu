import { redirect } from "react-router";
import type { Route } from "./+types/signout";
import { API } from "../lib/config";
import { clearCookieHeaders, getRefreshToken } from "../lib/auth.server";
import { verifyCsrf } from "../lib/csrf.server";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const submitted = form.get("csrf_token") as string | null;

  if (!verifyCsrf(request, submitted)) {
    throw new Response("Invalid CSRF token", { status: 403 });
  }

  const refreshToken = getRefreshToken(request);
  if (refreshToken) {
    await fetch(`${API}/api/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }).catch(() => null);
  }

  const headers = new Headers();
  for (const [k, v] of clearCookieHeaders()) headers.append(k, v);
  throw redirect("/", { headers });
}
