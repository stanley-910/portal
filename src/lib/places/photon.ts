import { regionName, type PlaceKind, type PlaceResult } from "./place";

// Photon (komoot) geocodes OpenStreetMap data with no key. Fair use only: keep requests few and cached.
// https://photon.komoot.io
const ENDPOINT = "https://photon.komoot.io/api/";
const USER_AGENT = "Portal (HKU Hackathon)";
const TIMEOUT_MS = 1500;
const LIMIT = 8;
const CACHE_SIZE = 500;

// Only places you travel between: settlements and regions, stations, airports and ferry terminals.
const OSM_TAGS = ["place", "railway:station", "public_transport:station", "aeroway:aerodrome", "amenity:ferry_terminal"];
const PLACE_KINDS: Record<string, PlaceKind> = {
  country: "country",
  state: "region",
  province: "region",
  region: "region",
  county: "region",
  city: "city",
  town: "city",
  village: "city",
  municipality: "city",
  island: "city",
};
const MIN_SPAN: Record<PlaceKind, number> = { country: 4, region: 2, city: 1.5, airport: 1, station: 1 };

export interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_type?: string;
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    countrycode?: string;
    /** [west, north, east, south] */
    extent?: [number, number, number, number];
  };
}

export function photonUrl(query: string): string {
  const params = new URLSearchParams({ q: query, limit: String(LIMIT), lang: "en" });
  for (const tag of OSM_TAGS) params.append("osm_tag", tag);
  return `${ENDPOINT}?${params}`;
}

function kindOf({ osm_key: key, osm_value: value }: PhotonFeature["properties"]): PlaceKind | null {
  if (key === "place") return (value && PLACE_KINDS[value]) || null;
  if (key === "aeroway") return "airport";
  if (key === "railway" || key === "public_transport" || key === "amenity") return "station";
  return null;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

/** Photon's features as places, dropping anything that isn't somewhere you'd travel to. */
export function toPlaces(features: readonly PhotonFeature[]): PlaceResult[] {
  const places: PlaceResult[] = [];
  for (const f of features) {
    const p = f.properties;
    const kind = kindOf(p);
    const [lng, lat] = f.geometry.coordinates;
    if (!kind || !p.name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    let span = MIN_SPAN[kind];
    if (p.extent) {
      const [w, n, e, s] = p.extent;
      span = Math.max(span, Math.abs(n - s), Math.abs(e - w) * Math.cos((lat * Math.PI) / 180));
    }
    places.push({
      id: `osm:${p.osm_type ?? ""}${p.osm_id ?? `${lat},${lng}`}`,
      kind,
      name: p.name,
      detail: kind === "country" ? "" : p.countrycode ? regionName(p.countrycode) : "",
      label: p.osm_key === "place" && p.osm_value && kind !== "country" ? capitalise(p.osm_value) : undefined,
      lat,
      lng,
      spanDeg: Math.min(span, 60),
      source: "osm",
    });
  }
  return places;
}

const cache = new Map<string, PlaceResult[]>();

/** Places matching `query` from OpenStreetMap. Throws when Photon is slow or down; callers fall back to bundled data. */
export async function geocodePlaces(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const key = query.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const response = await fetch(photonUrl(query.trim()), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`photon returned ${response.status}`);
  const data = (await response.json()) as { features?: PhotonFeature[] };
  const places = toPlaces(data.features ?? []);
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, places);
  return places;
}
