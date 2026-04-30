import { useLoaderData, Link } from "react-router";
import { API } from "../lib/config";
import { MangaGrid } from "../components/MangaCard";

export async function loader() {
  const res  = await fetch(`${API}/api/completed`);
  const data = await res.json();
  return { manga: data.mangaList || [] };
}

export default function Completed() {
  const { manga } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen bg-zinc-950 text-white pb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl sm:text-2xl font-bold">Completed Series</h1>
          <Link to="/" className="text-sm text-zinc-400 hover:text-white transition-colors">← Home</Link>
        </div>
        {manga.length === 0
          ? <p className="text-zinc-500 text-sm py-12 text-center">No completed series found.</p>
          : <MangaGrid manga={manga} showComplete hoverColor="text-blue-400" />
        }
      </div>
    </div>
  );
}
