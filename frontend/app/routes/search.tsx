import { API } from "../lib/config";

// Resource route powering the navbar search overlay and admin manga search.
// Falls back to live Suwayomi source search when DB results are sparse.
export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const q   = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 3) return { mangaList: [], query: q };

  const res  = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  return { mangaList: data.mangaList ?? [], query: q };
}
