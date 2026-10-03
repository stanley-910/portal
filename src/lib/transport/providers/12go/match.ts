import type { Place } from "../../types";
import { matchRadiusKm } from "../match-radius";

import type { SeedRoute } from "./index";

export const MIN_SNAP_DISTANCE_KM = 30;

function distanceKm(a: Place, b: SeedRoute["from"]): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function nearestStop(place: Place, routes: SeedRoute[], side: "from" | "to", radiusKm = MIN_SNAP_DISTANCE_KM) {
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
  return nearest && nearestDistance <= radiusKm
    ? { stop: nearest, distanceKm: nearestDistance }
    : null;
}

/** Which way the query runs along the route, within the shared match radius. If both ways fit, the smaller total snap wins. */
export function matchesRoute(queryFrom: Place, queryTo: Place, route: SeedRoute): "forward" | "reverse" | null {
  const radiusKm = matchRadiusKm(queryFrom, queryTo, MIN_SNAP_DISTANCE_KM);
  const forwardKm = distanceKm(queryFrom, route.from) + distanceKm(queryTo, route.to);
  const reverseKm = distanceKm(queryFrom, route.to) + distanceKm(queryTo, route.from);
  const forward = distanceKm(queryFrom, route.from) <= radiusKm && distanceKm(queryTo, route.to) <= radiusKm;
  const reverse = distanceKm(queryFrom, route.to) <= radiusKm && distanceKm(queryTo, route.from) <= radiusKm;
  if (forward && reverse) return reverseKm < forwardKm ? "reverse" : "forward";
  if (forward) return "forward";
  return reverse ? "reverse" : null;
}
