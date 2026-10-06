// The hubs offered when someone picks a stop's airport, station or ferry terminal. Browser-safe and local: no geocoder.
import { fold } from "@/lib/places/place";

import { HUBS } from "./browser";
import { distanceKm, type Coordinates } from "./geo";
import { HUB_LIMITS } from "./limits";
import { GeoIndex } from "./spatial";
import type { Hub } from "./types";

const LIMIT = 8;
// km a point of importance is worth: a large airport a little further off comes before a regional one next door
// (Seattle–Tacoma before Boeing Field)
const IMPORTANCE_KM = 25;

// built on first use: where each hub is, and its folded name and city to match against
let index: { geo: GeoIndex<Hub>; keys: Map<Hub, string[]> } | null = null;
const indexed = () => (index ??= {
  geo: new GeoIndex(HUBS, (hub) => hub),
  keys: new Map(HUBS.map((hub) => [hub, [fold(hub.name), fold(hub.city)].filter(Boolean)])),
});

// 0 starts with, 1 a word starts with, 2 contains; null for no match
function rank(key: string, q: string): number | null {
  if (key.startsWith(q)) return 0;
  if (key.includes(` ${q}`)) return 1;
  if (q.length >= 3 && key.includes(q)) return 2;
  return null;
}

/**
 * With no query, the hubs a search from `near` would consider (inside each mode's radius), best placed first. With
 * one, hubs anywhere whose code, name or city matches it: an exact code first, then the closer match, and among equal
 * matches the hub nearer `near`.
 */
export function hubChoices(query: string, near: Coordinates): Hub[] {
  const { geo, keys } = indexed();
  const q = fold(query);
  const placed = (hub: Hub, km: number) => km - hub.importance * IMPORTANCE_KM;
  if (!q) {
    return geo.nearby(near, HUB_LIMITS.radiusKm.flight)
      .map((hub) => ({ hub, km: distanceKm(near, hub) }))
      .filter(({ hub, km }) => km <= HUB_LIMITS.radiusKm[hub.mode])
      .sort((a, b) => placed(a.hub, a.km) - placed(b.hub, b.km) || (a.hub.id < b.hub.id ? -1 : 1))
      .slice(0, LIMIT)
      .map(({ hub }) => hub);
  }
  const code = q.replace(/ /g, "").toUpperCase();
  const scored: { hub: Hub; tier: number; score: number }[] = [];
  for (const hub of HUBS) {
    let tier: number | null = hub.code === code ? -1 : null;
    if (tier === null) {
      for (const key of keys.get(hub)!) {
        const r = rank(key, q);
        if (r !== null && (tier === null || r < tier)) tier = r;
      }
    }
    if (tier !== null) scored.push({ hub, tier, score: placed(hub, distanceKm(near, hub)) });
  }
  return scored
    .sort((a, b) => a.tier - b.tier || a.score - b.score || (a.hub.id < b.hub.id ? -1 : 1))
    .slice(0, LIMIT)
    .map(({ hub }) => hub);
}

/** A hub outside the area a search from `near` looks in: picking it means going somewhere else, not a nearby hub. */
export const beyondReach = (near: Coordinates, hub: Hub): boolean => distanceKm(near, hub) > HUB_LIMITS.radiusKm[hub.mode];

/** Two hubs of different modes, which can't be the two ends of one leg. */
export const crossesModes = (a: Hub | null, b: Hub | null): boolean => !!a && !!b && a.mode !== b.mode;

let ids: Map<string, Hub> | null = null;
/** A bundled hub by its id, or null for none or one this catalogue doesn't have. */
export function hubById(id: string | null | undefined): Hub | null {
  if (!id) return null;
  ids ??= new Map(HUBS.map((hub) => [hub.id, hub]));
  return ids.get(id) ?? null;
}
