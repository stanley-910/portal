// ISO 3166-1 alpha-2 ↔ alpha-3 for the 199 dataset countries, including HK, MO and TW.
// iso-codes.json is derived row-by-row from the dataset's own iso2 and iso3 CSVs at the pinned commit.
// Entry data is keyed by alpha-3; the transport contract (Place.country) uses alpha-2, so convert at the edge.
import ISO2_TO_ISO3 from "./iso-codes.json" with { type: "json" };

const toIso3: Record<string, string> = ISO2_TO_ISO3;
const toIso2: Record<string, string> = Object.fromEntries(Object.entries(toIso3).map(([a2, a3]) => [a3, a2]));

/** Accepts alpha-2 or alpha-3 in any case. Returns alpha-3, or undefined for an unknown code. */
export function iso3(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const c = code.trim().toUpperCase();
  if (c.length === 3) return toIso2[c] ? c : undefined;
  if (c.length === 2) return toIso3[c];
  return undefined;
}

export function iso2(code: string): string | undefined {
  const c = iso3(code);
  return c ? toIso2[c] : undefined;
}
