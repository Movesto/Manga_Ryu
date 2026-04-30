export const API   = "http://127.0.0.1:8000";
export const MEDIA = "http://127.0.0.1:4567"; // server-side only — never sent to browsers

// All browser-facing image URLs go through the /media proxy route.
export const imgUrl = (path: string) => `/media${path}`;
