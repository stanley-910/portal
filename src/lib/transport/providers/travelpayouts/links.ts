const AVIASALES_ORIGIN = "https://www.aviasales.com";

export function withTpMarker(url: string, marker?: string): string {
  if (!marker) return url;
  const parsed = new URL(url);
  const existing = parsed.searchParams.get("marker");
  if (existing) {
    parsed.searchParams.delete("marker");
    parsed.searchParams.set("marker", existing);
    return parsed.toString();
  }
  parsed.searchParams.set("marker", marker);
  return parsed.toString();
}

export function aviasalesUrl(link: string, marker?: string): string {
  const absolute = new URL(link, AVIASALES_ORIGIN).toString();
  return withTpMarker(absolute, marker);
}
