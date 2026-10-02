const AVIASALES_ORIGIN = "https://www.aviasales.com";

export function withTpMarker(url: string, marker?: string): string {
  const parsed = new URL(url);
  const selectedMarker = parsed.searchParams.getAll("marker").find(Boolean) || marker;
  // Collapse duplicates and empty values even when no new marker was configured.
  parsed.searchParams.delete("marker");
  if (selectedMarker) parsed.searchParams.set("marker", selectedMarker);
  return parsed.toString();
}

/** Upstream data may supply a relative search link, not an arbitrary redirect. */
export function aviasalesUrl(link: string, marker?: string): string | undefined {
  try {
    const parsed = new URL(link, AVIASALES_ORIGIN);
    if (parsed.origin !== AVIASALES_ORIGIN || parsed.username || parsed.password ||
        !parsed.pathname.startsWith("/search/")) return undefined;
    return withTpMarker(parsed.toString(), marker);
  } catch {
    return undefined;
  }
}
