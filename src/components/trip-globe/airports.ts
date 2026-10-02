// Mock hubs for the prototype, copied from the Flight artboard. POR-6 replaces this with the static hub dataset.
import { angle, D2R, EARTH_RADIUS_KM, vecOf, type Vec3 } from "./vec";

export interface Airport {
  code: string;
  city: string;
  lat: number;
  lng: number;
  /** 0.8 (regional) to 3 (major hub). Snapping favours bigger hubs. */
  weight: number;
}

// [code, city, lat, lng, hub weight]
const RAW: [string, string, number, number, number][] = [
  ["HKG", "Hong Kong", 22.31, 113.92, 3], ["PEK", "Beijing", 40.08, 116.58, 3], ["PVG", "Shanghai", 31.14, 121.81, 3],
  ["CAN", "Guangzhou", 23.39, 113.3, 2], ["CTU", "Chengdu", 30.58, 103.95, 2], ["TPE", "Taipei", 25.08, 121.23, 2],
  ["HND", "Tokyo", 35.55, 139.78, 3], ["KIX", "Osaka", 34.43, 135.23, 2], ["ICN", "Seoul", 37.46, 126.44, 3],
  ["MNL", "Manila", 14.51, 121.02, 2], ["BKK", "Bangkok", 13.69, 100.75, 3], ["SGN", "Ho Chi Minh City", 10.82, 106.65, 2],
  ["HAN", "Hanoi", 21.22, 105.81, 1.5], ["SIN", "Singapore", 1.36, 103.99, 3], ["KUL", "Kuala Lumpur", 2.75, 101.71, 2],
  ["CGK", "Jakarta", -6.13, 106.66, 2], ["DPS", "Bali", -8.75, 115.17, 1.5], ["DEL", "Delhi", 28.56, 77.1, 3],
  ["BOM", "Mumbai", 19.09, 72.87, 3], ["BLR", "Bengaluru", 13.2, 77.71, 2], ["CMB", "Colombo", 7.18, 79.88, 1],
  ["KTM", "Kathmandu", 27.7, 85.36, 1], ["MLE", "Malé", 4.19, 73.53, 1], ["DXB", "Dubai", 25.25, 55.36, 3],
  ["DOH", "Doha", 25.27, 51.61, 2], ["RUH", "Riyadh", 24.96, 46.7, 1.5], ["IST", "Istanbul", 41.26, 28.74, 3],
  ["TLV", "Tel Aviv", 32.01, 34.89, 1.5], ["CAI", "Cairo", 30.12, 31.41, 2], ["ADD", "Addis Ababa", 8.98, 38.8, 2],
  ["NBO", "Nairobi", -1.32, 36.93, 2], ["JNB", "Johannesburg", -26.14, 28.24, 2], ["CPT", "Cape Town", -33.97, 18.6, 2],
  ["LOS", "Lagos", 6.58, 3.32, 2], ["ACC", "Accra", 5.61, -0.17, 1], ["CMN", "Casablanca", 33.37, -7.59, 1.5],
  ["LHR", "London", 51.47, -0.45, 3], ["CDG", "Paris", 49.01, 2.55, 3], ["AMS", "Amsterdam", 52.31, 4.76, 3],
  ["FRA", "Frankfurt", 50.04, 8.56, 3], ["MUC", "Munich", 48.35, 11.79, 2], ["ZRH", "Zurich", 47.46, 8.55, 2],
  ["MAD", "Madrid", 40.49, -3.57, 3], ["BCN", "Barcelona", 41.3, 2.08, 2], ["LIS", "Lisbon", 38.77, -9.13, 2],
  ["FCO", "Rome", 41.8, 12.25, 2], ["MXP", "Milan", 45.63, 8.72, 2], ["ATH", "Athens", 37.94, 23.94, 1.5],
  ["VIE", "Vienna", 48.11, 16.57, 1.5], ["CPH", "Copenhagen", 55.62, 12.66, 2], ["ARN", "Stockholm", 59.65, 17.92, 1.5],
  ["OSL", "Oslo", 60.19, 11.1, 1.5], ["HEL", "Helsinki", 60.32, 24.96, 1.5], ["KEF", "Reykjavík", 63.99, -22.62, 1],
  ["DUB", "Dublin", 53.42, -6.27, 2], ["WAW", "Warsaw", 52.17, 20.97, 1.5], ["PRG", "Prague", 50.1, 14.26, 1.5],
  ["SVO", "Moscow", 55.97, 37.41, 2], ["ALA", "Almaty", 43.35, 77.04, 1], ["TAS", "Tashkent", 41.26, 69.28, 1],
  ["VVO", "Vladivostok", 43.4, 132.15, 0.8], ["JFK", "New York", 40.64, -73.78, 3], ["BOS", "Boston", 42.36, -71.01, 2],
  ["IAD", "Washington", 38.95, -77.46, 2], ["ATL", "Atlanta", 33.64, -84.43, 3], ["MIA", "Miami", 25.79, -80.29, 2],
  ["ORD", "Chicago", 41.98, -87.9, 3], ["DFW", "Dallas", 32.9, -97.04, 3], ["DEN", "Denver", 39.86, -104.67, 2],
  ["LAX", "Los Angeles", 33.94, -118.41, 3], ["SFO", "San Francisco", 37.62, -122.38, 3], ["SEA", "Seattle", 47.45, -122.31, 2],
  ["YVR", "Vancouver", 49.19, -123.18, 2], ["YYZ", "Toronto", 43.68, -79.63, 3], ["YUL", "Montréal", 45.47, -73.74, 2],
  ["MEX", "Mexico City", 19.44, -99.07, 3], ["CUN", "Cancún", 21.04, -86.87, 1.5], ["HNL", "Honolulu", 21.32, -157.92, 2],
  ["ANC", "Anchorage", 61.17, -149.99, 1], ["PTY", "Panama City", 9.07, -79.38, 1.5], ["BOG", "Bogotá", 4.7, -74.15, 2],
  ["UIO", "Quito", -0.13, -78.36, 1], ["LIM", "Lima", -12.02, -77.11, 2], ["GRU", "São Paulo", -23.43, -46.47, 3],
  ["GIG", "Rio de Janeiro", -22.81, -43.25, 2], ["EZE", "Buenos Aires", -34.82, -58.54, 2], ["SCL", "Santiago", -33.39, -70.79, 2],
  ["SYD", "Sydney", -33.94, 151.18, 3], ["MEL", "Melbourne", -37.67, 144.84, 2], ["BNE", "Brisbane", -27.38, 153.12, 1.5],
  ["PER", "Perth", -31.94, 115.97, 1.5], ["AKL", "Auckland", -37.01, 174.79, 2], ["NAN", "Nadi", -17.76, 177.44, 1],
  ["PPT", "Papeete", -17.55, -149.61, 1],
];

export const AIRPORTS: Airport[] = RAW.map(([code, city, lat, lng, weight]) => ({ code, city, lat, lng, weight }));
const VECS = AIRPORTS.map((a) => vecOf(a.lat * D2R, a.lng * D2R));

/** The airport a point on the globe snaps to: nearest by distance, with a 220 km pull per step of hub weight. */
export function nearestAirport(v: Vec3): { airport: Airport; v: Vec3 } {
  let best = 0;
  let bestScore = Infinity;
  for (let i = 0; i < AIRPORTS.length; i++) {
    const score = EARTH_RADIUS_KM * angle(v, VECS[i]) + (3 - AIRPORTS[i].weight) * 220;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return { airport: AIRPORTS[best], v: VECS[best] };
}
