export function relativeTime(ms: number): string {
  if (!ms) return "";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 3600)     return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)    return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800)   return `${Math.floor(s / 86400)}d ago`;
  if (s < 2592000)  return `${Math.floor(s / 604800)}w ago`;
  if (s < 31536000) return `${Math.floor(s / 2592000)} mo ago`;
  return `${Math.floor(s / 31536000)} yr ago`;
}

export function chNum(n: number): string {
  return n % 1 === 0 ? String(Math.floor(n)) : String(n);
}
