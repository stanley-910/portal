export type HotelKind = "hotel" | "hostel";
export type HotelFilter = "hostel" | 2 | 3 | 4 | 5;

export interface Hotel {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  kind: HotelKind;
  stars?: 2 | 3 | 4 | 5;
  bedsPerRoom: number;
  /** For one room. Estimates are in USD; live rates keep the currency the provider quoted. */
  pricePerNight: { amount: number; currency: string };
  /** "live" is a rate quoted for these dates; anything else shows as estimated. */
  freshness: "live" | "estimated";
  distanceKm: number;
  score: number;
  bookingUrl?: string;
  source?: string;
  sourceUrl?: string;
  quote?: { checkIn: string; checkOut: string; occupants: number; quotedAt: string; guestNationality?: string };
}

export interface HotelSearchQuery {
  city: string;
  lat: number;
  lng: number;
  checkIn: string;
  checkOut: string;
  occupants: number;
  filter: HotelFilter;
  /** Explicit guest nationality, ISO-2; never inferred from the destination. */
  guestNationality?: string;
}

export interface HotelResult extends Hotel {
  rooms: number;
  totalPrice: { amount: number; currency: string };
  nights: number;
}
