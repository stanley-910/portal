"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { bookingNoticeOf, cancelSettle, confirmCardHold, dismissNotice, expireBookings, pendingIntent, savedCards, savedTraveller, saveTraveller, seatStep, settleLeg, startCardHold, startPayment, submitDetails, submitSavedDetails, type Actor, type Failure, type PriceChange } from "@/lib/booking/flow";
import type { TravellerDetails } from "@/lib/booking/offer";
import type { SavedCard } from "@/lib/booking/stripe";
import { env } from "@/lib/env.server";
import { currentPerson } from "@/lib/identity";
import { liveblocks } from "@/lib/liveblocks/server";
import { TRIP_ID, tripRoomId, type Money } from "@/lib/liveblocks/types";

// Booking a leg (docs/booking/README.md), as the plan panel calls it. Each action checks the caller is a member of
// the room, then hands over to the flow; what comes back is shaped for the leg to show, never a provider's record.

const LEG_ID = /^[A-Za-z0-9_-]{1,64}$/;
const moneySchema = z.object({ amount: z.number().finite().min(0), currency: z.string().regex(/^[A-Z]{3}$/) });

const notMember: Failure = { ok: false, code: "NOT_ALLOWED", message: "Join the trip first." };

async function member(tripId: string, legId: string): Promise<{ roomId: string; actor: Actor } | null> {
  if (typeof tripId !== "string" || !TRIP_ID.test(tripId) || typeof legId !== "string" || !LEG_ID.test(legId)) return null;
  const roomId = tripRoomId(tripId);
  const person = await currentPerson();
  const room = await liveblocks().getRoom(roomId).catch(() => null);
  if (!person || !room?.usersAccesses[person.id]) return null;
  // a lapsed deadline is handled before anything else happens to the leg
  await expireBookings(roomId);
  return { roomId, actor: { id: person.id, name: person.name, email: person.email } };
}

/** Fixes the group on the chosen flight. A moved price comes back first; call again with `accept` to go on. */
export async function settleLegAction(tripId: string, legId: string, accept?: unknown): Promise<{ ok: true; mode: "group" | "separate" } | PriceChange | Failure> {
  const m = await member(tripId, legId);
  if (!m) return notMember;
  const price = accept === undefined ? undefined : moneySchema.safeParse(accept);
  if (price && !price.success) return { ok: false, code: "INVALID", message: "Bad price." };
  return settleLeg(m.roomId, legId, m.actor, price?.data);
}

export async function cancelSettleAction(tripId: string, legId: string): Promise<{ ok: true } | Failure> {
  const m = await member(tripId, legId);
  if (!m) return notMember;
  return cancelSettle(m.roomId, legId, m.actor);
}

/** The caller's own traveller details. Validated against what the airline needs; a passport only when asked. */
export async function submitDetailsAction(tripId: string, legId: string, details: unknown): Promise<{ ok: true } | Failure> {
  const m = await member(tripId, legId);
  if (!m) return notMember;
  return submitDetails(m.roomId, legId, m.actor, details);
}

/**
 * The caller's share as a card hold. Returns a Checkout URL to send them to, or null when the no-charge test
 * checkout has already recorded it. Separate tickets may report a moved price first.
 */
export async function payShareAction(tripId: string, legId: string, accept?: unknown): Promise<{ ok: true; url: string | null } | PriceChange | Failure> {
  const m = await member(tripId, legId);
  if (!m) return notMember;
  const price = accept === undefined ? undefined : moneySchema.safeParse(accept);
  if (price && !price.success) return { ok: false, code: "INVALID", message: "Bad price." };
  return startPayment(m.roomId, legId, m.actor, await siteOrigin(), price?.data as Money | undefined);
}

export type SoloStep = { ok: true; step: "details" | "pay" | "wait" | "done"; documents: boolean; share: Money };

/**
 * Book on the home globe, for one rider: settles the leg unless it already is, and says what the rider does next. A
 * moved price comes back first, as with a settle.
 */
export async function startSoloBookingAction(tripId: string, legId: string, accept?: unknown): Promise<SoloStep | PriceChange | Failure> {
  const m = await member(tripId, legId);
  if (!m) return notMember;
  const price = accept === undefined ? undefined : moneySchema.safeParse(accept);
  if (price && !price.success) return { ok: false, code: "INVALID", message: "Bad price." };
  let at = await seatStep(m.roomId, legId, m.actor.id);
  if (!at) {
    const settled = await settleLeg(m.roomId, legId, m.actor, price?.data);
    if (!settled.ok) return settled;
    at = await seatStep(m.roomId, legId, m.actor.id);
  }
  return at ? { ok: true, ...at } : { ok: false, code: "WRONG_STATE", message: "This leg isn't settled." };
}

/** The rider's details, when still needed, then their card: a Checkout URL, or null once the seat is held or bought. */
export async function finishSoloBookingAction(tripId: string, legId: string, details: unknown, accept?: unknown): Promise<{ ok: true; url: string | null } | PriceChange | Failure> {
  const m = await member(tripId, legId);
  if (!m) return notMember;
  if ((await seatStep(m.roomId, legId, m.actor.id))?.step === "details") {
    const done = await submitDetails(m.roomId, legId, m.actor, details);
    if (!done.ok) return done;
  }
  const at = await seatStep(m.roomId, legId, m.actor.id);
  if (at?.step === "done") return { ok: true, url: null };
  if (at?.step !== "pay") return { ok: false, code: "WRONG_STATE", message: (await bookingNoticeOf(m.roomId, legId)) ?? "The airline didn't hold the seat. Try again." };
  const price = accept === undefined ? undefined : moneySchema.safeParse(accept);
  if (price && !price.success) return { ok: false, code: "INVALID", message: "Bad price." };
  return startPayment(m.roomId, legId, m.actor, await siteOrigin(), price?.data as Money | undefined);
}

export type Wallet = { traveller: TravellerDetails | null; cards: SavedCard[]; publishableKey: string | null; email: string | null; nationalities: string[] };

/** The caller's own saved details and cards, for their checkout. Never anyone else's. */
export async function myWalletAction(): Promise<Wallet | null> {
  const person = await currentPerson();
  if (!person) return null;
  const [traveller, cards] = await Promise.all([savedTraveller(person.id).catch(() => null), savedCards(person.id)]);
  return { traveller, cards, publishableKey: env.STRIPE_SECRET_KEY ? (env.STRIPE_PUBLISHABLE_KEY ?? null) : null, email: person.email, nationalities: person.nationalities };
}

/** The caller's saved details, used for this leg as they are ("Looks good"). */
export async function submitSavedDetailsAction(tripId: string, legId: string): Promise<{ ok: true } | Failure> {
  const m = await member(tripId, legId);
  if (!m) return notMember;
  return submitSavedDetails(m.roomId, legId, m.actor);
}

/** Details typed or edited in the checkout: saved for next time, then used for this leg. */
export async function saveAndSubmitDetailsAction(tripId: string, legId: string, details: unknown): Promise<{ ok: true } | Failure> {
  const m = await member(tripId, legId);
  if (!m) return notMember;
  const saved = await saveTraveller(m.actor.id, details);
  if (!saved.ok) return saved;
  return submitDetails(m.roomId, legId, m.actor, details);
}

/**
 * The caller's share as a card hold confirmed in the app: on a saved card, or on a new one when `paymentMethod` is
 * null. The client secret goes to Stripe.js; null means the seat is already held.
 */
export async function startCardHoldAction(tripId: string, legId: string, paymentMethod: unknown, accept?: unknown): Promise<{ ok: true; clientSecret: string | null } | PriceChange | Failure> {
  const m = await member(tripId, legId);
  if (!m) return notMember;
  if (paymentMethod !== null && (typeof paymentMethod !== "string" || !/^pm_[A-Za-z0-9]+$/.test(paymentMethod))) return { ok: false, code: "INVALID", message: "Bad card." };
  const price = accept === undefined ? undefined : moneySchema.safeParse(accept);
  if (price && !price.success) return { ok: false, code: "INVALID", message: "Bad price." };
  return startCardHold(m.roomId, legId, m.actor, paymentMethod, price?.data as Money | undefined);
}

/** Stripe.js finished with the caller's hold: record it. */
export async function confirmCardHoldAction(tripId: string, legId: string): Promise<{ ok: true } | Failure> {
  const m = await member(tripId, legId);
  if (!m) return notMember;
  const intent = await pendingIntent(m.roomId, legId, m.actor.id);
  if (intent && (await confirmCardHold(intent).catch(() => false))) return { ok: true };
  return { ok: false, code: "PAYMENT_FAILED", message: "The card wasn't held. Try again or use another card." };
}

export async function dismissBookingNoticeAction(tripId: string, legId: string): Promise<void> {
  const m = await member(tripId, legId);
  if (m) await dismissNotice(m.roomId, legId);
}

/** Where Stripe sends the rider back: this deployment, from the request's own headers. */
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
