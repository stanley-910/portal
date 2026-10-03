import type { LatLng, RemoteFlight, Vehicle } from "@/components/trip-globe";

/** The parts of trip storage a parked leg needs. */
export type StoredPlan = {
  readonly legs: {
    readonly [id: string]: {
      readonly from: string;
      readonly to: string;
      readonly chosen: string | null;
      readonly search: { readonly offers: readonly { readonly id: string; readonly mode: Vehicle }[] };
    };
  };
  readonly stops: { readonly [id: string]: LatLng };
};

/** Each stored leg as a landed trip: parked at its end as its chosen offer's vehicle, facing along the route. */
export function storedFlights(root: StoredPlan): RemoteFlight[] {
  const flights: RemoteFlight[] = [];
  for (const [id, leg] of Object.entries(root.legs)) {
    const from = root.stops[leg.from];
    const to = root.stops[leg.to];
    if (!from || !to) continue;
    const o = { lat: from.lat, lng: from.lng };
    const at = { lat: to.lat, lng: to.lng };
    // a hair past the end gives the heading; near enough on a great circle for a parked vehicle
    const ahead = { lat: at.lat + (at.lat - o.lat) * 0.01, lng: at.lng + (at.lng - o.lng) * 0.01 };
    const vehicle = leg.search.offers.find((offer) => offer.id === leg.chosen)?.mode ?? "flight";
    flights.push({ id: `leg:${id}`, origin: o, at, ahead, landed: true, vehicle });
  }
  return flights;
}
