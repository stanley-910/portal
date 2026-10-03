import type { City } from "./schema";

const R_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

/**
 * Nearest city whose radius contains the point; radii may overlap (JB / Woodlands).
 * `reach` widens each city's own radius (its floor) for a query; omitted, the city radius applies as is.
 */
export function cityAt(
  cities: readonly City[],
  lat: number,
  lng: number,
  reach: (floorKm: number) => number = (floorKm) => floorKm,
): City | undefined {
  let best: City | undefined;
  let bestKm = Number.POSITIVE_INFINITY;
  for (const c of cities) {
    const km = distanceKm(lat, lng, c.lat, c.lng);
    if (km <= reach(c.radiusKm) && km < bestKm) {
      best = c;
      bestKm = km;
    }
  }
  return best;
}
