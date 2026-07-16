import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("browse",               "routes/browse.tsx"),
  route("search",               "routes/search.tsx"),
  route("popular",              "routes/popular.tsx"),
  route("latest",               "routes/latest.tsx"),
  route("completed",            "routes/completed.tsx"),
  route("library",              "routes/library.tsx"),
  route("history",              "routes/history.tsx"),
  route("signin",               "routes/signin.tsx"),
  route("signout",              "routes/signout.tsx"),
  route("bookmark",             "routes/bookmark.tsx"),
  route("admin",                 "routes/admin.tsx"),
  route("admin/extensions",      "routes/admin.extensions.tsx"),
  route("source/:sourceId",     "routes/source.$sourceId.tsx"),
  route("manga/:mangaId",                          "routes/manga.$mangaId.tsx"),
  route("manga/:mangaId/chapter/:chapterId",       "routes/manga.$mangaId.chapter.$chapterId.tsx"),
  route("media/*",                                 "routes/media.$.tsx"),
  route("api/*",                                   "routes/api.$.tsx"),
] satisfies RouteConfig;
