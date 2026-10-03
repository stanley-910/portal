import type { Place } from "../types";
import { distanceKm } from "./gtfs/geo";

/** Same as the station hub radius in hubs/catalog.ts. */
export const MAX_MATCH_KM = 100;

/**
 * How far a surface provider may look for a station or city around a clicked point.
 * A click far from a city on a long trip should still find it, so the radius is 20% of the
 * click-to-click distance, never below the provider's own `floorKm` and never above
 * MAX_MATCH_KM (a floor above the cap wins). A short hop keeps the provider's tight radius,
 * so both ends can't snap to one city.
 */
export function matchRadiusKm(from: Place, to: Place, floorKm: number): number {
  const clickKm = distanceKm(from.lat, from.lng, to.lat, to.lng);
  return Math.max(floorKm, Math.min(0.2 * clickKm, MAX_MATCH_KM));
}
