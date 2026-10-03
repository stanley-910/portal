import type { Hotel, HotelFilter, HotelResult, HotelSearchQuery } from "./types";

const CATALOG: Array<Omit<Hotel, "distanceKm" | "score"> & { cityLat: number; cityLng: number; offsetLat: number; offsetLng: number }> = [
  { id: "hk-arch", name: "The Harbour Arch", city: "Hong Kong", cityLat: 22.31, cityLng: 114.18, offsetLat: 0.02, offsetLng: -0.01, kind: "hotel", stars: 4, bedsPerRoom: 2, pricePerNight: { amount: 148, currency: "USD" }, freshness: "estimated" },
  { id: "hk-house", name: "Kowloon House", city: "Hong Kong", cityLat: 22.31, cityLng: 114.18, offsetLat: -0.01, offsetLng: 0.02, kind: "hostel", bedsPerRoom: 4, pricePerNight: { amount: 38, currency: "USD" }, freshness: "estimated" },
  { id: "shanghai-lane", name: "Nanjing Road Lane", city: "Shanghai", cityLat: 31.22, cityLng: 121.43, offsetLat: 0.01, offsetLng: 0.01, kind: "hotel", stars: 4, bedsPerRoom: 2, pricePerNight: { amount: 112, currency: "USD" }, freshness: "estimated" },
  { id: "shanghai-garden", name: "Garden Bund Rooms", city: "Shanghai", cityLat: 31.22, cityLng: 121.43, offsetLat: -0.03, offsetLng: 0.02, kind: "hotel", stars: 3, bedsPerRoom: 2, pricePerNight: { amount: 72, currency: "USD" }, freshness: "estimated" },
  { id: "seoul-han", name: "Han River Stay", city: "Seoul", cityLat: 37.57, cityLng: 127, offsetLat: 0.02, offsetLng: 0.02, kind: "hotel", stars: 5, bedsPerRoom: 2, pricePerNight: { amount: 188, currency: "USD" }, freshness: "estimated" },
  { id: "seoul-rooftop", name: "Rooftop Mapo", city: "Seoul", cityLat: 37.57, cityLng: 127, offsetLat: -0.02, offsetLng: 0.01, kind: "hostel", bedsPerRoom: 4, pricePerNight: { amount: 34, currency: "USD" }, freshness: "estimated" },
  { id: "tokyo-paper", name: "Paper Lantern Hotel", city: "Tokyo", cityLat: 35.69, cityLng: 139.75, offsetLat: 0.01, offsetLng: -0.02, kind: "hotel", stars: 4, bedsPerRoom: 2, pricePerNight: { amount: 156, currency: "USD" }, freshness: "estimated" },
  { id: "tokyo-station", name: "Station House", city: "Tokyo", cityLat: 35.69, cityLng: 139.75, offsetLat: -0.02, offsetLng: 0.01, kind: "hostel", bedsPerRoom: 4, pricePerNight: { amount: 42, currency: "USD" }, freshness: "estimated" },
];

const EARTH_RADIUS_KM = 6371;
const radians = (value: number) => value * Math.PI / 180;
const distanceKm = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const dLat = radians(bLat - aLat);
  const dLng = radians(bLng - aLng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
};

const nightsBetween = (checkIn: string, checkOut: string) =>
  Math.max(1, Math.ceil((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000));

const matches = (hotel: Hotel, filter: HotelFilter) => filter === "hostel"
  ? hotel.kind === "hostel"
  : hotel.kind === "hotel" && hotel.stars === filter;

function fallbackCatalog(query: HotelSearchQuery) {
  return [2, 3, 4, 5].map((stars, index) => ({
    id: `${query.city.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stars}`,
    name: `${query.city} ${["Central", "Market", "Grand", "Atlas"][index]} Hotel`,
    city: query.city,
    cityLat: query.lat,
    cityLng: query.lng,
    offsetLat: (index - 1.5) * 0.012,
    offsetLng: (1.5 - index) * 0.01,
    kind: "hotel" as const,
    stars: stars as 2 | 3 | 4 | 5,
    bedsPerRoom: 2,
    pricePerNight: { amount: 58 + stars * 24 + index * 11, currency: "USD" as const },
    freshness: "estimated" as const,
  })).concat([{
    id: `${query.city.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-hostel`,
    name: `${query.city} Common Room`,
    city: query.city,
    cityLat: query.lat,
    cityLng: query.lng,
    offsetLat: 0.006,
    offsetLng: 0.008,
    kind: "hostel" as const,
    bedsPerRoom: 4,
    pricePerNight: { amount: 32, currency: "USD" as const },
    freshness: "estimated" as const,
  }]);
}

/**
 * Local fallback data, ranked by a balanced score: 60% nightly price and 40% distance to the selected city centre.
 * The score is deliberately relative to the returned set so a cheap central property can beat an expensive one.
 */
export function searchHotels(query: HotelSearchQuery): HotelResult[] {
  const cityCatalog = CATALOG.filter((hotel) => hotel.city.toLowerCase() === query.city.toLowerCase());
  const hasMatchingCatalog = cityCatalog.some((hotel) => query.filter === "hostel"
    ? hotel.kind === "hostel"
    : hotel.kind === "hotel" && hotel.stars === query.filter);
  const source = hasMatchingCatalog ? cityCatalog : fallbackCatalog(query);
  const candidates = source
    .filter((hotel) => hotel.city.toLowerCase() === query.city.toLowerCase())
    .map((hotel) => ({
      ...hotel,
      lat: hotel.cityLat + hotel.offsetLat,
      lng: hotel.cityLng + hotel.offsetLng,
      distanceKm: distanceKm(query.lat, query.lng, hotel.cityLat + hotel.offsetLat, hotel.cityLng + hotel.offsetLng),
      score: 0,
    }))
    .filter((hotel) => matches(hotel, query.filter));

  if (!candidates.length) return [];
  const maxPrice = Math.max(...candidates.map((hotel) => hotel.pricePerNight.amount), 1);
  const maxDistance = Math.max(...candidates.map((hotel) => hotel.distanceKm), 1);
  const nights = nightsBetween(query.checkIn, query.checkOut);
  return candidates
    .map((hotel) => ({
      ...hotel,
      score: 0.6 * hotel.pricePerNight.amount / maxPrice + 0.4 * hotel.distanceKm / maxDistance,
      rooms: Math.ceil(query.occupants / hotel.bedsPerRoom),
      totalPrice: { amount: hotel.pricePerNight.amount * Math.ceil(query.occupants / hotel.bedsPerRoom) * nights, currency: "USD" as const },
      nights,
    }))
    .sort((a, b) => a.score - b.score || a.pricePerNight.amount - b.pricePerNight.amount || a.id.localeCompare(b.id));
}
