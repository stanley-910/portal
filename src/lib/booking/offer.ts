import { z } from "zod";

import type { Money } from "@/lib/liveblocks/types";

// What the booking flow needs from a Duffel offer, and how it recognises the same flights in a fresh search. Pure
// and shared with tests; the calls themselves are in duffel.ts.

const flightSchema = z.object({
  marketing_carrier: z.object({ iata_code: z.string().nullish(), name: z.string() }),
  marketing_carrier_flight_number: z.string().nullish(),
  departing_at: z.string(),
  arriving_at: z.string(),
  origin: z.object({ iata_code: z.string() }),
  destination: z.object({ iata_code: z.string() }),
});

export const offerSchema = z
  .object({
    id: z.string().min(1),
    total_amount: z.string().regex(/^\d+(\.\d+)?$/),
    total_currency: z.string().regex(/^[A-Z]{3}$/),
    expires_at: z.string(),
    owner: z.object({ name: z.string() }),
    passengers: z.array(z.object({ id: z.string().min(1) })).min(1),
    passenger_identity_documents_required: z.boolean().nullish(),
    payment_requirements: z.object({
      requires_instant_payment: z.boolean(),
      payment_required_by: z.string().nullish(),
      price_guarantee_expires_at: z.string().nullish(),
    }),
    slices: z.array(z.object({ segments: z.array(flightSchema).min(1) })).min(1),
  })
  .transform((o): BookableOffer => {
    const flights = o.slices[0].segments.map((s) => ({
      number: `${s.marketing_carrier.iata_code ?? ""}${s.marketing_carrier_flight_number ?? ""}`,
      departingAt: s.departing_at,
      arrivingAt: s.arriving_at,
      from: s.origin.iata_code,
      to: s.destination.iata_code,
    }));
    return {
      id: o.id,
      total: { amount: Number(o.total_amount), currency: o.total_currency },
      passengerIds: o.passengers.map((p) => p.id),
      expiresAt: o.expires_at,
      airline: o.owner.name,
      documentsRequired: o.passenger_identity_documents_required ?? false,
      instantOnly: o.payment_requirements.requires_instant_payment,
      paymentRequiredBy: o.payment_requirements.payment_required_by ?? null,
      priceGuaranteeExpiresAt: o.payment_requirements.price_guarantee_expires_at ?? null,
      origin: flights[0].from,
      destination: flights[flights.length - 1].to,
      date: flights[0].departingAt.slice(0, 10),
      flights,
    };
  });

export type BookableOffer = {
  id: string;
  /** For every passenger together, as Duffel quotes it. */
  total: Money;
  passengerIds: string[];
  expiresAt: string;
  airline: string;
  documentsRequired: boolean;
  /** The airline won't hold seats: each rider buys their own. */
  instantOnly: boolean;
  paymentRequiredBy: string | null;
  priceGuaranteeExpiresAt: string | null;
  origin: string;
  destination: string;
  /** YYYY-MM-DD, local at the origin. */
  date: string;
  flights: { number: string; departingAt: string; arrivingAt: string; from: string; to: string }[];
};

/** What identifies a flight across searches. */
export type FlightKey = { number: string; departingAt: string; from: string; to: string };

/** Enough of an offer to search for the same flights again. */
export type OfferLike = Pick<BookableOffer, "origin" | "destination" | "date"> & { flights: FlightKey[] };

/** The same flights: every segment's flight number, airports and departure minute agree. */
export function sameFlights(a: { flights: readonly FlightKey[] }, b: { flights: readonly FlightKey[] }): boolean {
  return (
    a.flights.length === b.flights.length &&
    a.flights.every((f, i) => {
      const g = b.flights[i];
      return f.number === g.number && f.from === g.from && f.to === g.to && f.departingAt.slice(0, 16) === g.departingAt.slice(0, 16);
    })
  );
}

/**
 * The offer in `raw` for the same flights as `like`, with a seat for every passenger. Several fares can match; the
 * cheapest wins. Null when none does, which the flow reads as sold out.
 */
export function matchOffer(like: { flights: readonly FlightKey[] }, raw: readonly unknown[], passengers: number): BookableOffer | null {
  let best: BookableOffer | null = null;
  for (const item of raw) {
    const parsed = offerSchema.safeParse(item);
    if (!parsed.success) continue;
    const offer = parsed.data;
    if (offer.passengerIds.length !== passengers || !sameFlights(like, offer)) continue;
    if (!best || offer.total.amount < best.total.amount) best = offer;
  }
  return best;
}

export const offerExpired = (offer: BookableOffer, now = Date.now()) => Date.parse(offer.expiresAt) <= now;

/** Per-seat price of an offer, for comparing with what the leg showed. */
export const perSeat = (offer: BookableOffer): Money => ({
  amount: Math.round((offer.total.amount / offer.passengerIds.length) * 100) / 100,
  currency: offer.total.currency,
});

/** What Duffel needs about one traveller. Held server-side only, sealed, and deleted once the order exists. */
export type TravellerDetails = {
  title: "mr" | "ms" | "mrs" | "miss" | "dr";
  gender: "m" | "f";
  givenName: string;
  familyName: string;
  /** YYYY-MM-DD */
  bornOn: string;
  email: string;
  /** E.164, e.g. +85291234567 */
  phone: string;
  passport?: { number: string; /** ISO 3166-1 alpha-2 */ country: string; /** YYYY-MM-DD */ expiresOn: string } | null;
};

// letters, spaces, hyphens and apostrophes: airlines refuse digits and most punctuation in names
const name = z.string().trim().min(1).max(60).regex(/^\p{L}[\p{L} '\-]*$/u, "letters only");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => Number.isFinite(Date.parse(`${d}T00:00:00Z`)), "not a date");

/** Validates what a rider typed. Passport fields are checked only when the offer asks for them. */
export const travellerSchema = (documentsRequired: boolean) =>
  z.object({
    title: z.enum(["mr", "ms", "mrs", "miss", "dr"]),
    gender: z.enum(["m", "f"]),
    givenName: name,
    familyName: name,
    bornOn: isoDate.refine((d) => d < new Date().toISOString().slice(0, 10), "must be in the past"),
    email: z.email().max(120),
    phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "international format, e.g. +85291234567"),
    passport: documentsRequired
      ? z.object({
          number: z.string().trim().min(5).max(20).regex(/^[A-Za-z0-9]+$/),
          country: z.string().trim().length(2).transform((s) => s.toUpperCase()),
          expiresOn: isoDate.refine((d) => d > new Date().toISOString().slice(0, 10), "must be in the future"),
        })
      : z.null().optional().default(null),
  });
