import type { LandedTrip } from "@/components/trip-globe";
import { nearestPreviewHub } from "@/lib/transport/hubs/preview";
import { distanceKm } from "@/lib/transport/hubs/geo";
import { soloSaveSchema } from "./solo-schema";
import type { LegPick } from "./solo-input";

/** Reconstruct display state only after validating the same bounded input accepted by Save. */
export function restoreSolo(input: unknown) {
  const parsed = soloSaveSchema.safeParse(input);
  if (!parsed.success) return null;
  const legs: LandedTrip[] = parsed.data.legs.map((leg) => ({
    origin: leg.from, destination: leg.to,
    from: nearestPreviewHub(leg.from), to: nearestPreviewHub(leg.to),
    distanceKm: distanceKm(leg.from, leg.to), departDate: new Date(`${leg.date}T00:00`),
  }));
  const picks: LegPick[] = parsed.data.legs.map((leg) => ({
    offer: leg.offers.find((offer) => offer.id === leg.chosen) ?? null,
    offers: leg.offers, depart: leg.date, stay: leg.stay ?? null,
  }));
  return { input: parsed.data, legs, picks };
}
