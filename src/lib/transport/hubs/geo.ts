export interface Coordinates { lat: number; lng: number }

/** Haversine distance: safe at the date line, poles and antipodes. */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
