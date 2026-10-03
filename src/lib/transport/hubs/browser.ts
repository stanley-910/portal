import data from "./browser-data.json";
import type { Hub } from "./types";

type AirportRow = [code: string, name: string, city: string, lat: number, lng: number, country: string, importance: number, source: number];
/** Exact preview fields and provenance, encoded without repeated keys/source URLs. */
export const HUBS: readonly Hub[] = [
  ...(data.airports as AirportRow[]).map(([code, name, city, lat, lng, country, importance, source]): Hub => ({
    id: `airport:${code}`, mode: "flight", code, iata: code, name, city, lat, lng, country, importance, source: data.sources[source],
  })),
  ...data.surface as Hub[],
];
