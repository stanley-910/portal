import type { Stop } from "@/lib/liveblocks/types";
import type { StayListing } from "@/lib/hotels/types";
import type { Offer } from "@/lib/transport/types";

import { keepOffers, MAX_OFFERS } from "./offers";

// What Save trip on `/` sends (`soloSaveSchema` in server.ts checks it): the landed legs with what was picked on each,
// and, for a round trip, one more leg from the last stop back to where the trip started. Pure, so it can be tested.

/** A hotel picked in the ticket card: the group's cost per night there. */
export type PickedStay = { label: string; nightly: { amount: number; currency: string }; estimated: boolean; listing?: StayListing };

/** What the ticket card picked on one leg. */
export type LegPick = { offer: Offer | null; offers: Offer[]; depart: string; stay: PickedStay | null };

/** The option picked for the way back, with every return option the card showed and the return date. */
export type ReturnPick = { offer: Offer; offers: Offer[]; date: string };

/** The options saved with a leg: what a room keeps of the search, in its order, always including the pick. */
export function savedOptions(offer: Offer, offers: Offer[]): Offer[] {
  return offers.some((o) => o.id === offer.id) ? keepOffers(offers, offer.id) : [offer, ...keepOffers(offers, null, MAX_OFFERS - 1)];
}

/** A pick on the way back as the leg it adds: the last stop to the first, on the return date. */
export function returnLegPick(back: ReturnPick): LegPick {
  return { offer: back.offer, offers: back.offers, depart: back.date, stay: null };
}

/**
 * The save input for legs landed on `/`. `picks` has one per leg, in order, and may carry one more: the way back,
 * which becomes a leg from the last leg's destination to the first leg's origin. With no legs, no legs.
 */
export function soloSaveInput(legs: { from: Stop; to: Stop }[], picks: LegPick[]) {
  const route = legs.length && picks.length > legs.length ? [...legs, { from: legs.at(-1)!.to, to: legs[0].from }] : legs;
  return {
    legs: route.map((leg, i) => {
      const pick = picks[i];
      return {
        from: leg.from,
        to: leg.to,
        date: pick.depart,
        offers: pick.offer ? savedOptions(pick.offer, pick.offers) : [],
        chosen: pick.offer?.id ?? null,
        ...(pick.stay ? { stay: pick.stay } : {}),
      };
    }),
  };
}
