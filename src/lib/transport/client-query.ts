import type { LandedTrip } from "@/components/trip-globe";

/** Use the local departure date, not UTC (which can shift it to yesterday). */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** An end of a search: the clicked point, and the hub it was snapped to, if any. */
export type SearchEnd = { lat: number; lng: number; snap?: string };

/** Local preview hub locations must never replace the actual clicked points. A snapped end names its hub. */
export function clickSearchParams<T extends Pick<LandedTrip, "departDate"> & { origin: SearchEnd; destination: SearchEnd }>(trip: T): URLSearchParams {
  const end = ({ lat, lng, snap }: SearchEnd) => (snap ? { lat, lng, snap } : { lat, lng });
  return new URLSearchParams({
    from: JSON.stringify({ name: "Origin", ...end(trip.origin) }),
    to: JSON.stringify({ name: "Destination", ...end(trip.destination) }),
    date: localDate(trip.departDate),
    modes: "flight,train,bus,ferry",
    currency: "USD",
    passengers: "1",
    resolve: "hubs",
  });
}
