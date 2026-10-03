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
  pricePerNight: { amount: number; currency: "USD" };
  freshness: "estimated";
  distanceKm: number;
  score: number;
  bookingUrl?: string;
}

export interface HotelSearchQuery {
  city: string;
  lat: number;
  lng: number;
  checkIn: string;
  checkOut: string;
  occupants: number;
  filter: HotelFilter;
}

export interface HotelResult extends Hotel {
  rooms: number;
  totalPrice: { amount: number; currency: "USD" };
  nights: number;
}
