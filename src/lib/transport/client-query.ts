import type { LandedTrip } from "@/components/trip-globe";

/** Use the local departure date, not UTC (which can shift it to yesterday). */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Local preview hub locations must never replace the actual clicked points. */
export function clickSearchParams(trip: LandedTrip): URLSearchParams {
  return new URLSearchParams({
    from: JSON.stringify({ name: "Origin", ...trip.origin }),
    to: JSON.stringify({ name: "Destination", ...trip.destination }),
    date: localDate(trip.departDate),
    modes: "flight,train,bus,ferry",
    currency: "USD",
    passengers: "1",
    resolve: "hubs",
  });
}
