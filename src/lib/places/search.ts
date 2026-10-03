import { COUNTRY_LABELS, type CountryLabel } from "@/components/trip-globe/countries";
import { HUBS } from "@/lib/transport/hubs/browser";
import type { Hub } from "@/lib/transport/hubs/types";

import { fold, regionName, type PlaceResult } from "./place";

export { fold, type PlaceKind, type PlaceResult } from "./place";

interface Entry {
  place: PlaceResult;
  /** Folded names to match against; the first is the display name. */
  keys: string[];
  /** Ties between equally good matches go to the bigger place. */
  weight: number;
}

const CITY_SPAN = 2;
const HUB_SPAN = 1;
const LIMIT = 8;

export function buildPlaceIndex(hubs: readonly Hub[] = HUBS, countries: readonly CountryLabel[] = COUNTRY_LABELS): Entry[] {
  const entries: Entry[] = [];
  for (const c of countries) {
    entries.push({
      place: { id: `country:${c.name}`, kind: "country", name: c.name, detail: "", lat: c.lat, lng: c.lng, spanDeg: Math.max(c.span, c.width, CITY_SPAN) },
      keys: [fold(c.name)],
      weight: 10 + Math.log10(1 + c.area),
    });
  }
  // A city sits on its most important hub. Airport data names districts too ("Shanghai (Pudong)"); drop them.
  const cities = new Map<string, { name: string; hub: Hub }>();
  for (const h of hubs) {
    const name = h.city?.replace(/\s*\(.*\)\s*$/, "").trim();
    if (!name) continue;
    const key = `${fold(name)}|${h.country}`;
    const best = cities.get(key);
    if (!best || h.importance > best.hub.importance) cities.set(key, { name, hub: h });
  }
  for (const [key, { name, hub: h }] of cities) {
    entries.push({
      place: { id: `city:${key}`, kind: "city", name, detail: regionName(h.country ?? ""), lat: h.lat, lng: h.lng, spanDeg: CITY_SPAN },
      keys: [fold(name)],
      weight: 5 + h.importance,
    });
  }
  for (const h of hubs) {
    const airport = h.mode === "flight";
    entries.push({
      place: {
        id: h.id, kind: airport ? "airport" : "station", name: h.name, detail: regionName(h.country ?? ""),
        code: airport ? h.iata ?? h.code : undefined, lat: h.lat, lng: h.lng, spanDeg: HUB_SPAN,
      },
      keys: [fold(h.name)],
      weight: h.importance,
    });
  }
  return entries;
}

// 0 exact, 1 starts with, 2 a word starts with, 3 contains; null for no match.
function rank(key: string, q: string): number | null {
  if (key === q) return 0;
  if (key.startsWith(q)) return 1;
  if (key.includes(` ${q}`)) return 2;
  if (q.length >= 3 && key.includes(q)) return 3;
  return null;
}

let defaultIndex: Entry[] | null = null;

/** Places whose name or airport code matches `query`, best first. */
export function searchPlaces(query: string, index?: Entry[], limit = LIMIT): PlaceResult[] {
  const q = fold(query);
  if (!q) return [];
  index ??= (defaultIndex ??= buildPlaceIndex());
  const codeQuery = /^[a-z]{3}$/.test(q) ? q.toUpperCase() : null;
  const scored: { place: PlaceResult; score: number }[] = [];
  for (const e of index) {
    // An exact IATA code beats everything.
    if (codeQuery && e.place.code === codeQuery) {
      scored.push({ place: e.place, score: -1 });
      continue;
    }
    let best: number | null = null;
    for (const k of e.keys) {
      const r = rank(k, q);
      if (r !== null && (best === null || r < best)) best = r;
    }
    if (best !== null) scored.push({ place: e.place, score: best * 100 - e.weight });
  }
  scored.sort((a, b) => a.score - b.score || a.place.name.localeCompare(b.place.name));
  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const { place } of scored) {
    // Hubs often share their city's name ("Shanghai" station); keep one row per name and country.
    const key = `${place.name}|${place.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(place);
    if (out.length === limit) break;
  }
  return out;
}

const NEAR_KM = 3;
const kmBetween = (a: PlaceResult, b: PlaceResult) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

/** Bundled matches first, then online ones that aren't already there: same name, or the same kind of place nearby. */
export function mergePlaces(local: readonly PlaceResult[], online: readonly PlaceResult[], { local: maxLocal = 6, online: maxOnline = 4 } = {}): PlaceResult[] {
  const kept = local.slice(0, maxLocal);
  const extra: PlaceResult[] = [];
  for (const place of online) {
    if (extra.length === maxOnline) break;
    const dup = [...local, ...extra].some((p) =>
      (fold(p.name) === fold(place.name) && p.detail === place.detail) || (p.kind === place.kind && kmBetween(p, place) < NEAR_KM));
    if (!dup) extra.push(place);
  }
  return [...kept, ...extra];
}
