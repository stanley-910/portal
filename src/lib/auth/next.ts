/** Same-site path to follow after auth. Anything else (absolute URLs, `//host`, `javascript:`) falls back to `/`. */
export function safeNext(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  // Control characters (tab/newline) are stripped by URL parsers, so `/\t/evil.com` could become `//evil.com`.
  if (/[\u0000-\u001f]/.test(raw)) return "/";
  return raw;
}
