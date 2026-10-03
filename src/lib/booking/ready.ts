import type { LegBooking, StoredOffer } from "@/lib/liveblocks/types";
import { isBookable } from "@/lib/trip/offers";

import { BookingError } from "./errors";
import type { OfferLike } from "./offer";

// Whether a leg can be settled, decided from the plan alone so the flow, the panel and Pip agree. Pure, no Duffel.

type LegLike = {
  riders: readonly string[];
  chosen: string | null;
  search: { offers: readonly StoredOffer[] };
  booking?: LegBooking | null;
};

/** The chosen Duffel offer and its id at Duffel when `actorId` may settle `leg`; otherwise why not. */
export function settleReady<L extends LegLike>(leg: L | null | undefined, actorId: string): { ok: true; leg: L; chosen: StoredOffer; offerId: string } | { ok: false; error: BookingError } {
  if (!leg) return { ok: false, error: new BookingError("NOT_FOUND", "That leg is gone.") };
  if (leg.booking) return { ok: false, error: new BookingError("WRONG_STATE", "This leg is already settled.") };
  if (!leg.riders.includes(actorId)) return { ok: false, error: new BookingError("NOT_ALLOWED", "Only a rider can settle a leg.") };
  const chosen = leg.search.offers.find((o) => o.id === leg.chosen);
  if (!chosen || !isBookable(chosen) || !chosen.id.startsWith("duffel:")) return { ok: false, error: new BookingError("WRONG_STATE", "Pick a live flight first.") };
  return { ok: true, leg, chosen, offerId: chosen.id.slice("duffel:".length) };
}

/** The flights a stored option was for, to search them again when Duffel no longer has the offer itself. */
export function storedFlights(chosen: StoredOffer): OfferLike | null {
  const flights = chosen.flights;
  if (!flights?.length) return null;
  return {
    origin: flights[0].from,
    destination: flights[flights.length - 1].to,
    // local at the origin, as Duffel writes departure dates
    date: flights[0].depart.slice(0, 10),
    flights: flights.map((f) => ({ number: f.number, from: f.from, to: f.to, departingAt: f.depart })),
  };
}
