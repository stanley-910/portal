import { CITY_LABELS } from "@/components/trip-globe/cities";

import type { HotelFilter, HotelResult, HotelSearchQuery, StayListing } from "./types";

/**
 * Typical stays by area, not real properties: the names say what kind of place and where, so nobody books one that
 * doesn't exist. Prices are rough nightly rates for a room (a dorm bed for hostels).
 */
export type CatalogStay = Omit<HotelResult, "distanceKm" | "score" | "rooms" | "totalPrice" | "nights">;

/**
 * What a picked stay is booked as, on its own and apart from the legs: the property when a provider listed it, else
 * its city for a typical stay. Only for stays the search links out; a live quote is never sent to another seller.
 */
export const stayListing = (hotel: Pick<HotelResult, "city" | "name" | "source" | "bookingUrl">): StayListing | undefined =>
  !hotel.bookingUrl ? undefined : hotel.source ? { city: hotel.city, place: hotel.name } : { city: hotel.city };

/** A Booking.com search for the stay's dates and party: the city for a typical stay, the place itself when it's real. */
export const bookingUrl = (
  hotel: Pick<CatalogStay, "city"> & { place?: string },
  checkIn: string,
  checkOut: string,
  occupants: number,
) => {
  const params = new URLSearchParams({
    ss: hotel.place ? `${hotel.place}, ${hotel.city}` : hotel.city,
    checkin: checkIn,
    checkout: checkOut,
    group_adults: String(occupants),
    no_rooms: "1",
  });
  return `https://www.booking.com/searchresults.html?${params}`;
};

const CATALOG: CatalogStay[] = [
  { id: "hk-4-tst", name: "4★ hotel, Tsim Sha Tsui", city: "Hong Kong", lat: 22.298, lng: 114.172, kind: "hotel", stars: 4, bedsPerRoom: 2, pricePerNight: { amount: 148, currency: "USD" }, freshness: "estimated" },
  { id: "hk-hostel-mk", name: "Hostel, Mong Kok", city: "Hong Kong", lat: 22.319, lng: 114.169, kind: "hostel", bedsPerRoom: 4, pricePerNight: { amount: 38, currency: "USD" }, freshness: "estimated" },
  { id: "sh-4-nanjing", name: "4★ hotel, Nanjing Road", city: "Shanghai", lat: 31.235, lng: 121.475, kind: "hotel", stars: 4, bedsPerRoom: 2, pricePerNight: { amount: 112, currency: "USD" }, freshness: "estimated" },
  { id: "sh-3-jingan", name: "3★ hotel, Jing'an", city: "Shanghai", lat: 31.228, lng: 121.448, kind: "hotel", stars: 3, bedsPerRoom: 2, pricePerNight: { amount: 72, currency: "USD" }, freshness: "estimated" },
  { id: "seoul-5-gangnam", name: "5★ hotel, Gangnam", city: "Seoul", lat: 37.498, lng: 127.028, kind: "hotel", stars: 5, bedsPerRoom: 2, pricePerNight: { amount: 188, currency: "USD" }, freshness: "estimated" },
  { id: "seoul-hostel-hongdae", name: "Hostel, Hongdae", city: "Seoul", lat: 37.556, lng: 126.924, kind: "hostel", bedsPerRoom: 4, pricePerNight: { amount: 34, currency: "USD" }, freshness: "estimated" },
  { id: "tokyo-4-ginza", name: "4★ hotel, Ginza", city: "Tokyo", lat: 35.671, lng: 139.765, kind: "hotel", stars: 4, bedsPerRoom: 2, pricePerNight: { amount: 156, currency: "USD" }, freshness: "estimated" },
  { id: "tokyo-hostel-asakusa", name: "Hostel, Asakusa", city: "Tokyo", lat: 35.712, lng: 139.796, kind: "hostel", bedsPerRoom: 4, pricePerNight: { amount: 42, currency: "USD" }, freshness: "estimated" },
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

export const nightsBetween = (checkIn: string, checkOut: string) =>
  Math.max(1, Math.ceil((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000));

export const matches = (hotel: Pick<CatalogStay, "kind" | "stars">, filter: HotelFilter) => filter === "hostel"
  ? hotel.kind === "hostel"
  : hotel.kind === "hotel" && hotel.stars === filter;

const sameCity = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The city's centre from the globe's city labels, or the searched point when the city isn't one of them. */
export function centre(query: HotelSearchQuery) {
  const label = CITY_LABELS.find(([name]) => sameCity(name, query.city));
  return label ? { lat: label[1], lng: label[2] } : { lat: query.lat, lng: query.lng };
}

/** A typical nightly room rate (a dorm bed for hostels) in USD: the catalogue's for its cities, else the rough model's. */
export function typicalNightly(city: string, kind: CatalogStay["kind"], stars?: CatalogStay["stars"]): number {
  const known = CATALOG.find((h) => sameCity(h.city, city) && h.kind === kind && (kind === "hostel" || h.stars === stars));
  if (known) return known.pricePerNight.amount;
  return kind === "hostel" ? 32 : 58 + (stars ?? 3) * 24;
}

/** Rough stays around the centre for cities the catalogue doesn't cover, named by kind only. */
function fallbackCatalog(query: HotelSearchQuery, at: { lat: number; lng: number }): CatalogStay[] {
  const slug = query.city.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const hotels = ([2, 3, 4, 5] as const).map((stars, index): CatalogStay => ({
    id: `${slug}-${stars}`,
    name: `${stars}★ hotel near the centre`,
    city: query.city,
    lat: at.lat + (index - 1.5) * 0.012,
    lng: at.lng + (1.5 - index) * 0.01,
    kind: "hotel",
    stars,
    bedsPerRoom: 2,
    pricePerNight: { amount: 58 + stars * 24 + index * 11, currency: "USD" },
    freshness: "estimated",
  }));
  return [...hotels, {
    id: `${slug}-hostel`,
    name: "Hostel near the centre",
    city: query.city,
    lat: at.lat + 0.006,
    lng: at.lng + 0.008,
    kind: "hostel",
    bedsPerRoom: 4,
    pricePerNight: { amount: 32, currency: "USD" },
    freshness: "estimated",
  }];
}

/**
 * Ranks stays by a balanced score: 60% nightly price and 40% distance to the city centre. The score is deliberately
 * relative to the returned set so a cheap central property can beat an expensive one. Live stays come with their own
 * room count and total, which the score keeps.
 */
export function rankStays(stays: Array<CatalogStay & { rooms?: number; total?: number }>, query: HotelSearchQuery): HotelResult[] {
  const at = centre(query);
  const candidates = stays.map((hotel) => ({ ...hotel, distanceKm: distanceKm(at.lat, at.lng, hotel.lat, hotel.lng) }));
  if (!candidates.length) return [];
  const maxPrice = Math.max(...candidates.map((hotel) => hotel.pricePerNight.amount), 1);
  const maxDistance = Math.max(...candidates.map((hotel) => hotel.distanceKm), 1);
  const nights = nightsBetween(query.checkIn, query.checkOut);
  return candidates
    .map(({ total, ...hotel }) => {
      const rooms = hotel.rooms ?? Math.ceil(query.occupants / hotel.bedsPerRoom);
      return {
        ...hotel,
        score: 0.6 * hotel.pricePerNight.amount / maxPrice + 0.4 * hotel.distanceKm / maxDistance,
        rooms,
        totalPrice: { amount: total ?? hotel.pricePerNight.amount * rooms * nights, currency: hotel.pricePerNight.currency },
        nights,
        bookingUrl: hotel.bookingUrl ?? (hotel.freshness === "estimated" ? bookingUrl(hotel, query.checkIn, query.checkOut, query.occupants) : undefined),
      };
    })
    .sort((a, b) => a.score - b.score || a.pricePerNight.amount - b.pricePerNight.amount || a.id.localeCompare(b.id));
}

/** Local estimated stays: the catalogue for cities it covers, else rough stays around the centre. */
export function searchHotels(query: HotelSearchQuery): HotelResult[] {
  const cityCatalog = CATALOG.filter((hotel) => sameCity(hotel.city, query.city));
  const source = cityCatalog.some((hotel) => matches(hotel, query.filter)) ? cityCatalog : fallbackCatalog(query, centre(query));
  return rankStays(source.filter((hotel) => matches(hotel, query.filter)), query);
}
