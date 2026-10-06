import type { LandedTrip } from "@/components/trip-globe";
import { bestNearbyHub, hubById } from "@/lib/transport/hubs/pick";
import { distanceKm } from "@/lib/transport/hubs/geo";
import { soloSaveSchema } from "./solo-schema";
import type { LegPick } from "./solo-input";

/** Reconstruct display state only after validating the same bounded input accepted by Save. */
export function restoreSolo(input: unknown) {
  const parsed = soloSaveSchema.safeParse(input);
  if (!parsed.success) return null;
  // a snapped stop keeps its hub, so the trip lands again as it was saved
  const hub = (stop: { lat: number; lng: number; hub: string | null; snapped?: boolean }) =>
    (stop.snapped ? hubById(stop.hub) : null);
  const legs: LandedTrip[] = parsed.data.legs.map((leg) => {
    const snapped = { from: !!hub(leg.from), to: !!hub(leg.to) };
    return {
      origin: leg.from, destination: leg.to,
      from: hub(leg.from) ?? bestNearbyHub(leg.from), to: hub(leg.to) ?? bestNearbyHub(leg.to),
      distanceKm: distanceKm(leg.from, leg.to), departDate: new Date(`${leg.date}T00:00`),
      ...(snapped.from || snapped.to ? { snapped } : {}),
    };
  });
  const picks: LegPick[] = parsed.data.legs.map((leg) => ({
    offer: leg.offers.find((offer) => offer.id === leg.chosen) ?? null,
    offers: leg.offers, depart: leg.date, stay: leg.stay ?? null,
  }));
  return { input: parsed.data, legs, picks };
}
