// A place the search can turn the globe to, shared by the bundled index and the online geocoder.

export type PlaceKind = "country" | "region" | "city" | "airport" | "station";

export interface PlaceResult {
  id: string;
  kind: PlaceKind;
  name: string;
  /** The country, short English form; empty for a country itself. */
  detail: string;
  /** What the place is, when more specific than its kind, e.g. `Town` or `Province`. */
  label?: string;
  /** IATA code for airports. */
  code?: string;
  lat: number;
  lng: number;
  /** How much of the globe to frame, in degrees of arc. */
  spanDeg: number;
  /** Set on places found online rather than in the bundled data. */
  source?: "osm";
}

/** Lowercase, accents and punctuation dropped, so `sao paulo` finds `São Paulo`. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** A country's short English name from its ISO code, e.g. `HK` to `Hong Kong`. */
export const regionName = (() => {
  const names = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames("en", { type: "region", style: "short" }) : null;
  return (code: string) => {
    try {
      return names?.of(code) ?? code;
    } catch {
      return code;
    }
  };
})();
