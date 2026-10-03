import { DEMO_BOOKING } from "@/lib/demo";
import type { LegBooking, StoredOffer } from "@/lib/liveblocks/types";
import { HUBS } from "@/lib/transport/hubs/catalog";
import { nearestPreviewHub } from "@/lib/transport/hubs/preview";
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

/**
 * The chosen Duffel offer and its id at Duffel when `actorId` may settle `leg`; otherwise why not. In demo mode any
 * priced pick settles, and `offerId` is null when it isn't a Duffel offer: a sandbox flight stands in for it.
 */
export function settleReady<L extends LegLike>(leg: L | null | undefined, actorId: string): { ok: true; leg: L; chosen: StoredOffer; offerId: string | null } | { ok: false; error: BookingError } {
  if (!leg) return { ok: false, error: new BookingError("NOT_FOUND", "That leg is gone.") };
  if (leg.booking) return { ok: false, error: new BookingError("WRONG_STATE", "This leg is already settled.") };
  if (!leg.riders.includes(actorId)) return { ok: false, error: new BookingError("NOT_ALLOWED", "Only a rider can settle a leg.") };
  const chosen = leg.search.offers.find((o) => o.id === leg.chosen);
  if (!chosen || !isBookable(chosen) || (!DEMO_BOOKING && !chosen.id.startsWith("duffel:"))) return { ok: false, error: new BookingError("WRONG_STATE", "Pick a live flight first.") };
  return { ok: true, leg, chosen, offerId: chosen.id.startsWith("duffel:") ? chosen.id.slice("duffel:".length) : null };
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

/**
 * Which rider a Duffel field error is about, from its JSON pointer ("/passengers/1/phone_number"): passengers are sent
 * in rider order. Null for an error about the order as a whole, which has to send the leg back to planning.
 */
export function refusedPassenger(field: string | undefined, riders: readonly string[]): { rider: string; field: string } | null {
  const m = field?.match(/^\/passengers\/(\d+)\/(.+)$/);
  const rider = m && riders[Number(m[1])];
  return rider ? { rider, field: m[2].split("/").pop()!.replace(/_/g, " ") } : null;
}

const AIRPORTS = HUBS.filter((h) => h.mode === "flight");

/**
 * Demo stand-in: the airport for a stop. An airport hub is its own code; a station or a bare point takes the nearest
 * airport in the catalog (within 200 km), so a trip from West Kowloon flies from HKG.
 */
export function airportFor(stop: { lat: number; lng: number; hub: string | null; code?: string | null } | undefined): string | null {
  if (!stop) return null;
  if (stop.hub?.startsWith("airport:") && stop.code && /^[A-Z]{3}$/.test(stop.code)) return stop.code;
  return nearestPreviewHub(stop, AIRPORTS)?.code ?? null;
}
