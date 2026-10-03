import { GeoIndex } from "@/lib/transport/hubs/spatial";
import type { Hub } from "@/lib/transport/hubs/types";

import { CITY_LABELS } from "./cities";
import type { LatLng } from "./engine";
import { D2R, vecOf } from "./vec";

/** How far from a printed city a point still takes its name. */
const REACH_KM = 100;
const EARTH_KM = 6371;
const COS_REACH = Math.cos(REACH_KM / EARTH_KM);

const CITIES = CITY_LABELS.map(([name, lat, lng]) => ({ name, lat, lng, v: vecOf(lat * D2R, lng * D2R) }));
const INDEX = new GeoIndex(CITIES, (c) => c);

/**
 * The city a point is in or near, for the label beside the plane: the nearest printed city within reach, else the
 * nearest hub's city. The trip picks its airport, station or pier only once it lands.
 */
export function placeName(ll: LatLng, hub: Hub | null): string | null {
  const v = vecOf(ll.lat * D2R, ll.lng * D2R);
  let best: string | null = null;
  let bestDot = COS_REACH;
  for (const city of INDEX.nearby(ll, REACH_KM)) {
    const c = city.v;
    const d = c[0] * v[0] + c[1] * v[1] + c[2] * v[2];
    if (d > bestDot) {
      bestDot = d;
      best = city.name;
    }
  }
  if (best !== null) return best;
  // airport data names districts too ("Shanghai (Pudong)"); the city is enough
  return hub?.city?.replace(/\s*\(.*\)\s*$/, "").trim() || null;
}
