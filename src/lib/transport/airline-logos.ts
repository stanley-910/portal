import snapshot from "./airline-logos.json";

// Airlines with a logo on Duffel's CDN, snapshotted by `pnpm airlines:snapshot`. Only the image loads at runtime.
const CODES = new Set(snapshot.codes);

/** The airline's square logo, drawn for a light background, or null when it has none. */
export function airlineLogoUrl(code: string | null | undefined): string | null {
  const c = code?.trim().toUpperCase();
  return c && CODES.has(c) ? snapshot.template.replace("{code}", c) : null;
}
