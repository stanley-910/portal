import type { Place } from "../../types";

import type { SeedRoute } from "./index";

export const MAX_SNAP_DISTANCE_KM = 30;

function distanceKm(a: Place, b: SeedRoute["from"]): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function nearestStop(place: Place, routes: SeedRoute[], side: "from" | "to") {
  let nearest: SeedRoute["from"] | undefined;
  let nearestDistance = Infinity;
  for (const route of routes) {
    const stop = route[side];
    const distance = distanceKm(place, stop);
    if (distance < nearestDistance) {
      nearest = stop;
      nearestDistance = distance;
    }
  }
  return nearest && nearestDistance <= MAX_SNAP_DISTANCE_KM
    ? { stop: nearest, distanceKm: nearestDistance }
    : null;
}

export function matchesRoute(queryFrom: Place, queryTo: Place, route: SeedRoute): "forward" | "reverse" | null {
  const fromToFrom = distanceKm(queryFrom, route.from);
  const toToTo = distanceKm(queryTo, route.to);
  if (fromToFrom <= MAX_SNAP_DISTANCE_KM && toToTo <= MAX_SNAP_DISTANCE_KM) return "forward";
  const fromToTo = distanceKm(queryFrom, route.to);
  const toToFrom = distanceKm(queryTo, route.from);
  if (fromToTo <= MAX_SNAP_DISTANCE_KM && toToFrom <= MAX_SNAP_DISTANCE_KM) return "reverse";
  return null;
}
