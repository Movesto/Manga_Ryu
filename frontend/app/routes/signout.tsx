import { redirect } from "react-router";
import type { Route } from "./+types/signout";
import { API } from "../lib/config";
import { clearCookieHeaders } from "../lib/auth.server";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const refreshToken = form.get("refresh_token") as string | null;

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
