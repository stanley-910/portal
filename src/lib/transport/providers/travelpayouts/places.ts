import airports from "./airports.json";
import type { Place } from "../../types";

type AirportRecord = {
  code: string;
  city_code?: string;
  country_code?: string;
  coordinates: { lat: number; lon: number };
  flightable: boolean;
  iata_type?: string;
};

const MAX_SNAP_DISTANCE_KM = 150;
const records = airports as AirportRecord[];
const byCode = new Map(records.map((airport) => [airport.code, airport]));

function distanceKm(a: Place, b: { lat: number; lon: number }): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.lon - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function toIata(place: Place): string | null {
  if (place.iata) {
    const airport = byCode.get(place.iata.toUpperCase());
    return airport?.city_code ?? place.iata.toUpperCase();
  }
  let closest: AirportRecord | undefined;
  let closestDistance = Infinity;
  for (const airport of records) {
    if (!airport.flightable) continue;
    const distance = distanceKm(place, airport.coordinates);
    if (distance < closestDistance) {
      closest = airport;
      closestDistance = distance;
    }
  }
  if (!closest || closestDistance > MAX_SNAP_DISTANCE_KM) return null;
  return closest.city_code ?? closest.code;
}
