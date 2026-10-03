import "server-only";

import type { PlanJson } from "@/lib/agent/snapshot";
import { liveblocks } from "@/lib/liveblocks/server";
import type { BookingSeat, LegBooking, Money } from "@/lib/liveblocks/types";

import { cancelOrder, createOrder, findOfferFor, getOffer, getOrder, payOrder } from "./duffel";
import { BookingError, isBookingError, type BookingErrorCode } from "./errors";
import { offerExpired, perSeat, travellerSchema, type BookableOffer, type TravellerDetails } from "./offer";
import { refusedPassenger, settleReady, storedFlights } from "./ready";
import { allDetailsIn, allPaid, anyonePaid, bookingDeadline, openSeats, priceRose, splitShares } from "./shares";
import { bookingStore, type PaymentRow } from "./store";
import { cancelPayment, capturePayment, captureBefore, createCustomer, createHoldCheckout, createHoldIntent, getCheckoutSession, getPaymentIntent, listCards, stripeConfigured, testCheckoutAllowed, type SavedCard } from "./stripe";

// The booking flow from docs/booking/README.md. Every step reads the leg from the room, decides, calls Duffel or
// Stripe, then writes status back. Only this module writes `booking`; clients and Pip only read it.

export type Actor = { id: string; name: string | null; email: string | null };

export type Failure = { ok: false; code: BookingErrorCode | "INVALID"; message: string; fields?: string[]; field?: string };
export type PriceChange = { ok: false; code: "PRICE_CHANGED"; was: Money | null; now: Money };

type LegJson = NonNullable<PlanJson["legs"]>[string];

/** Riders have this long to enter details before a group settle lapses on its own. */
const DETAILS_WINDOW_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 2 * 60 * 1000;

const tripIdOf = (roomId: string) => roomId.replace(/^trip:/, "");
const over = (now: Money, agreed: Money) => priceRose(agreed, now);
const money = (m: Money) => `${m.currency} ${m.amount.toFixed(2)}`;

async function readLeg(roomId: string, legId: string): Promise<{ plan: PlanJson; leg: LegJson | null }> {
  const plan = (await liveblocks().getStorageDocument(roomId, "json")) as PlanJson;
  return { plan, leg: plan.legs?.[legId] ?? null };
}

/** Writes a leg's booking and notice together. A leg deleted meanwhile is left alone. */
async function writeBooking(roomId: string, legId: string, booking: LegBooking | null, notice?: string | null) {
  await liveblocks().mutateStorage(roomId, ({ root }) => {
    const leg = root.get("legs").get(legId);
    if (!leg) return;
    leg.set("booking", booking);
    if (notice !== undefined) leg.set("bookingNotice", notice);
  });
  await trackActive(roomId, legId, booking);
}

/** Keeps the sweep's list of in-progress bookings in step with the leg. Never fails the caller. */
async function trackActive(roomId: string, legId: string, booking: LegBooking | null) {
  const store = bookingStore();
  const active = !!booking && booking.status !== "booked";
  await (active ? store.markActive(roomId, legId) : store.clearActive(roomId, legId)).catch((e) => console.warn("[booking] track active failed", e));
}

async function updateSeat(roomId: string, legId: string, riderId: string, patch: Partial<BookingSeat>): Promise<LegBooking | null> {
  let result: LegBooking | null = null;
  await liveblocks().mutateStorage(roomId, ({ root }) => {
    const leg = root.get("legs").get(legId);
    const booking = leg?.get("booking");
    if (!leg || !booking || !booking.seats[riderId]) return;
    result = { ...booking, seats: { ...booking.seats, [riderId]: { ...booking.seats[riderId], ...patch } } };
    leg.set("booking", result);
  });
  return result;
}

const failure = (e: unknown, fallback = "Something went wrong."): Failure => {
  if (isBookingError(e)) return { ok: false, code: e.code, message: messageFor(e), field: typeof e.detail?.field === "string" ? e.detail.field : undefined };
  console.warn("[booking]", e instanceof Error ? e.message : e);
  return { ok: false, code: "UPSTREAM_ERROR", message: fallback };
};

function messageFor(e: BookingError): string {
  switch (e.code) {
    case "NOT_CONFIGURED":
      return "Booking isn't set up on this server.";
    case "OFFER_GONE":
    case "NOT_FOUND":
      return "That flight is gone.";
    case "PRICE_CHANGED":
      return "The price changed.";
    case "ORDER_FAILED":
      return typeof e.detail?.field === "string" && e.detail.field.startsWith("/passengers/") ? "The airline refused a traveller detail." : "The airline refused the booking.";
    case "PAYMENT_FAILED":
      return "The payment didn't go through.";
    case "UPSTREAM_ERROR":
      return "The airline didn't answer. Try again.";
    default:
      return e.message;
  }
}

/** The settled offer, or the same flights searched again when it has expired. Null when they're gone. */
async function currentOffer(booking: LegBooking, seats: number): Promise<BookableOffer | null> {
  const settled = await getOffer(booking.offerId).catch(() => null);
  if (settled && !offerExpired(settled) && settled.passengerIds.length === seats) return settled;
  // an expired offer is refused outright, so the flights kept at settle are searched for instead
  const flights = settled?.flights ?? booking.flights;
  if (!flights?.length) return null;
  return findOfferFor({ ...booking.route, flights }, seats);
}

/**
 * Settle: a rider fixes the group on the chosen Duffel flight. The server searches again with one seat per rider and
 * matches it by flight numbers. A moved price comes back for the group to see first; `accept` is the per-seat
 * price they agreed to. Airlines that won't hold put the leg on separate tickets.
 */
export async function settleLeg(roomId: string, legId: string, actor: Actor, accept?: Money): Promise<{ ok: true; mode: LegBooking["mode"] } | PriceChange | Failure> {
  try {
    const ready = settleReady((await readLeg(roomId, legId)).leg, actor.id);
    if (!ready.ok) throw ready.error;
    const { leg, chosen, offerId } = ready;
    // an offer Duffel has dropped is searched for again by the flights the leg kept
    const like = storedFlights(chosen);
    const original = await getOffer(offerId).catch((e) => {
      if (like && isBookingError(e) && (e.code === "NOT_FOUND" || e.code === "OFFER_GONE")) return like;
      throw e;
    });
    const fresh = await findOfferFor(original, leg.riders.length);
    if (!fresh) throw new BookingError("OFFER_GONE");
    const now = perSeat(fresh);
    if (over(now, accept ?? chosen.price ?? { amount: 0, currency: now.currency })) return { ok: false, code: "PRICE_CHANGED", was: accept ?? chosen.price, now };

    const mode: LegBooking["mode"] = fresh.instantOnly ? "separate" : "group";
    const settledAt = Date.now();
    const booking: LegBooking = {
      mode,
      status: mode === "group" ? "details" : "paying",
      offerId: fresh.id,
      route: { origin: fresh.origin, destination: fresh.destination, date: fresh.date },
      flights: fresh.flights.map(({ number, from, to, departingAt }) => ({ number, from, to, departingAt })),
      total: fresh.total,
      documents: fresh.documentsRequired,
      seats: openSeats(splitShares(fresh.total, leg.riders, actor.id)),
      deadline: mode === "group" ? new Date(settledAt + DETAILS_WINDOW_MS).toISOString() : null,
      settledBy: actor.id,
      settledAt,
    };
    await writeBooking(roomId, legId, booking, null);
    return { ok: true, mode };
  } catch (e) {
    return failure(e);
  }
}

/** Undoes a settle while nobody has paid. Any held seats go back to the airline. */
export async function cancelSettle(roomId: string, legId: string, actor: Actor): Promise<{ ok: true } | Failure> {
  try {
    const { leg } = await readLeg(roomId, legId);
    const booking = leg?.booking;
    if (!leg || !booking) throw new BookingError("WRONG_STATE", "Nothing to cancel.");
    if (!booking.seats[actor.id]) throw new BookingError("NOT_ALLOWED", "Only a rider can cancel a settle.");
    if (booking.status === "booked" || anyonePaid(booking.seats)) throw new BookingError("WRONG_STATE", "Someone has already paid.");
    await rollback(roomId, legId, booking, null);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** Puts a leg back in planning: the hold order and every card hold are cancelled, traveller details deleted. */
async function rollback(roomId: string, legId: string, booking: LegBooking, notice: string | null) {
  const store = bookingStore();
  if (booking.orderId) await cancelOrder(booking.orderId).catch((e) => console.warn("[booking] cancel order failed", isBookingError(e) ? e.code : e));
  for (const row of await store.listPayments(roomId, legId)) {
    if (row.status !== "held" && row.status !== "pending") continue;
    if (row.provider === "stripe" && row.paymentIntentId) await cancelPayment(row.paymentIntentId).catch((e) => console.warn("[booking] release hold failed", isBookingError(e) ? e.code : e));
    await store.upsertPayment({ ...row, status: "cancelled" });
  }
  await store.deleteTravellers(roomId, legId);
  await writeBooking(roomId, legId, null, notice);
}

/**
 * A rider's own traveller details. Kept server-side, sealed; the room only learns they're in. In a group booking the
 * last set of details holds the seats.
 */
export async function submitDetails(roomId: string, legId: string, actor: Actor, input: unknown): Promise<{ ok: true } | Failure> {
  try {
    const { leg } = await readLeg(roomId, legId);
    const booking = leg?.booking;
    if (!leg || !booking) throw new BookingError("WRONG_STATE", "This leg isn't settled.");
    if (!booking.seats[actor.id]) throw new BookingError("NOT_ALLOWED", "You're not riding this leg.");
    if (booking.status === "booked" || (booking.mode === "group" && booking.status !== "details")) throw new BookingError("WRONG_STATE", "The seats are already held.");
    if (booking.seats[actor.id].paid) throw new BookingError("WRONG_STATE", "You've already paid.");
    // a saved passport the airline didn't ask for stays out of the order
    const given = !booking.documents && input && typeof input === "object" ? { ...input, passport: null } : input;
    const parsed = travellerSchema(booking.documents).safeParse(given);
    if (!parsed.success) return { ok: false, code: "INVALID", message: "Check the highlighted fields.", fields: [...new Set(parsed.error.issues.map((i) => i.path.join(".")))] };
    await bookingStore().putTraveller(roomId, legId, actor.id, parsed.data as TravellerDetails);
    const updated = await updateSeat(roomId, legId, actor.id, { details: true });
    if (updated && updated.mode === "group" && allDetailsIn(updated.seats)) await holdSeats(roomId, legId);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** Group: every rider's details are in, so hold the seats. Failure sends the leg back to planning with the reason. */
async function holdSeats(roomId: string, legId: string) {
  const store = bookingStore();
  const { leg } = await readLeg(roomId, legId);
  const booking = leg?.booking;
  if (!booking || booking.status !== "details" || !allDetailsIn(booking.seats)) return;
  const riders = Object.keys(booking.seats);
  const travellers = await store.getTravellers(roomId, legId);
  const missing = riders.filter((r) => !travellers[r]);
  if (missing.length) {
    // the store lost them (a memory store restarted): ask again rather than hold the wrong people
    await liveblocks().mutateStorage(roomId, ({ root }) => {
      const l = root.get("legs").get(legId);
      const b = l?.get("booking");
      if (!l || !b) return;
      const seats = { ...b.seats };
      for (const r of missing) seats[r] = { ...seats[r], details: false };
      l.set("booking", { ...b, seats });
    });
    return;
  }
  const back = (notice: string) => rollback(roomId, legId, booking, notice);
  try {
    const offer = await currentOffer(booking, riders.length);
    if (!offer) return back("That flight is gone. Pick another and settle again.");
    if (over(offer.total, booking.total)) return back(`The price rose to ${money(offer.total)} for the group. Settle again if that's still right.`);
    const order = await createOrder({
      offer,
      travellers: riders.map((r) => travellers[r]),
      type: "hold",
      idempotencyKey: `${roomId}:${legId}:${booking.settledAt}:hold`,
      metadata: { room: roomId, leg: legId },
    });
    const total = order.total.amount <= booking.total.amount ? order.total : booking.total;
    const shares = splitShares(total, riders, booking.settledBy);
    const held: LegBooking = {
      ...booking,
      status: "paying",
      offerId: offer.id,
      orderId: order.id,
      reference: order.reference,
      total,
      deadline: bookingDeadline({ priceGuaranteeExpiresAt: order.priceGuaranteeExpiresAt, paymentRequiredBy: order.paymentRequiredBy }) ?? booking.deadline,
      seats: Object.fromEntries(riders.map((r) => [r, { ...booking.seats[r], share: shares[r], details: true }])),
    };
    await writeBooking(roomId, legId, held);
    // passports never outlive the order
    await store.deleteTravellers(roomId, legId);
  } catch (e) {
    const f = failure(e);
    const refused = refusedPassenger(f.field, riders);
    if (refused) {
      // one rider's detail was refused: only they enter theirs again; everyone else's stay in, and the settle stands
      await store.deleteTravellers(roomId, legId, refused.rider);
      await liveblocks().mutateStorage(roomId, ({ root }) => {
        const l = root.get("legs").get(legId);
        const b = l?.get("booking");
        if (!l || !b || b.status !== "details") return;
        l.set("booking", { ...b, seats: { ...b.seats, [refused.rider]: { ...b.seats[refused.rider], details: false } } });
        const who = root.get("members").get(refused.rider)?.get("name") ?? "That rider";
        l.set("bookingNotice", `The airline refused a traveller detail (${refused.field}). ${who} needs to check it and enter their details again.`);
      });
      return;
    }
    await back(f.field?.startsWith("/passengers/") ? `The airline refused a traveller detail (${f.field.split("/").pop()}). Check it and settle again.` : `${f.message} Settle again when you're ready.`);
  }
}

/**
 * The rider's share as a card hold. With Stripe, a Checkout page to send them to; without, the no-charge test
 * checkout marks the seat held at once. Separate tickets price the seat again first, so a rise shows before paying.
 */
export async function startPayment(roomId: string, legId: string, actor: Actor, origin: string, accept?: Money): Promise<{ ok: true; url: string | null } | PriceChange | Failure> {
  try {
    const store = bookingStore();
    const charge = await seatCharge(roomId, legId, actor, accept);
    if (charge.kind === "price") return charge.change;
    if (charge.kind === "held") return { ok: true, url: null };
    const { amount, offerId, booking } = charge;
    if (!stripeConfigured()) {
      if (!testCheckoutAllowed()) throw new BookingError("NOT_CONFIGURED", "Payments aren't set up on this server.");
      await store.upsertPayment({ roomId, legId, riderId: actor.id, provider: "test", sessionId: null, paymentIntentId: null, amount, status: "held", captureBefore: null, offerId });
      await recordHold(roomId, legId, actor.id);
      return { ok: true, url: null };
    }
    const session = await createHoldCheckout({
      share: amount,
      name: charge.name,
      description: charge.description,
      email: actor.email,
      successUrl: `${origin}/api/booking/return?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/t/${tripIdOf(roomId)}?book=${encodeURIComponent(legId)}`,
      metadata: { roomId, legId, riderId: actor.id },
      expiresInSec: booking.deadline ? Math.floor((Date.parse(booking.deadline) - Date.now()) / 1000) : undefined,
    });
    await store.upsertPayment({ roomId, legId, riderId: actor.id, provider: "stripe", sessionId: session.id, paymentIntentId: session.payment_intent, amount, status: "pending", captureBefore: null, offerId });
    return { ok: true, url: session.url };
  } catch (e) {
    return failure(e);
  }
}

type Charge =
  | { kind: "held" }
  | { kind: "price"; change: PriceChange }
  | { kind: "charge"; amount: Money; offerId: string | null; booking: LegBooking; name: string; description: string };

/**
 * What the rider pays now, after the checks every payment makes. Separate tickets price the seat again first, so a
 * rise shows before paying; a hold already recorded comes back as held.
 */
async function seatCharge(roomId: string, legId: string, actor: Actor, accept?: Money): Promise<Charge> {
  const store = bookingStore();
  const { plan, leg } = await readLeg(roomId, legId);
  const booking = leg?.booking;
  const seat = booking?.seats[actor.id];
  if (!leg || !booking || !seat) throw new BookingError("NOT_ALLOWED", "You're not riding this leg.");
  if (booking.status !== "paying") throw new BookingError("WRONG_STATE", booking.status === "booked" ? "This leg is booked." : "Waiting for everyone's details.");
  if (!seat.details) throw new BookingError("WRONG_STATE", "Enter your details first.");
  if (seat.paid) throw new BookingError("WRONG_STATE", "You've already paid.");
  const existing = await store.getPayment(roomId, legId, actor.id);
  if (existing?.status === "held") {
    await recordHold(roomId, legId, actor.id);
    return { kind: "held" };
  }

  let amount = seat.share;
  let offerId: string | null = null;
  if (booking.mode === "separate") {
    const offer = await currentOffer(booking, 1);
    if (!offer) throw new BookingError("OFFER_GONE");
    const now = offer.total;
    if (!accept ? over(now, seat.share) : over(now, accept)) return { kind: "price", change: { ok: false, code: "PRICE_CHANGED", was: accept ?? seat.share, now } };
    amount = now.amount < seat.share.amount ? now : seat.share;
    offerId = offer.id;
    if (amount.amount !== seat.share.amount) await updateSeat(roomId, legId, actor.id, { share: amount });
  }
  // a pending hold from an earlier try is released, so a rider is never holding twice
  if (existing?.status === "pending" && existing.provider === "stripe" && existing.paymentIntentId) {
    await cancelPayment(existing.paymentIntentId).catch(() => {});
  }
  const from = plan.stops?.[leg.from]?.name ?? leg.from;
  const to = plan.stops?.[leg.to]?.name ?? leg.to;
  return {
    kind: "charge",
    amount,
    offerId,
    booking,
    name: `${from} → ${to}, ${leg.date}`,
    description: booking.mode === "group" ? "Your seat. Held until everyone has paid." : "Your seat.",
  };
}

/** The Stripe customer a person's cards are saved to, made on first use. */
async function customerFor(actor: Actor): Promise<string> {
  const store = bookingStore();
  const known = await store.getCustomer(actor.id);
  if (known) return known;
  const customer = await createCustomer(actor.id, actor.email, actor.name);
  await store.putCustomer(actor.id, customer.id);
  return customer.id;
}

/** A person's saved cards; none without Stripe or before their first in-app payment. */
export async function savedCards(personId: string): Promise<SavedCard[]> {
  if (!stripeConfigured()) return [];
  const customer = await bookingStore().getCustomer(personId);
  return customer ? listCards(customer).catch(() => []) : [];
}

/**
 * Paying in the app: a card hold for the browser to confirm with Stripe.js, on a saved card (`paymentMethod`) or a
 * new one typed into the embedded field. Null secret means the seat is already held.
 */
export async function startCardHold(roomId: string, legId: string, actor: Actor, paymentMethod: string | null, accept?: Money): Promise<{ ok: true; clientSecret: string | null } | PriceChange | Failure> {
  try {
    if (!stripeConfigured()) throw new BookingError("NOT_CONFIGURED", "Payments aren't set up on this server.");
    const charge = await seatCharge(roomId, legId, actor, accept);
    if (charge.kind === "price") return charge.change;
    if (charge.kind === "held") return { ok: true, clientSecret: null };
    const customer = await customerFor(actor);
    // only the rider's own saved cards
    if (paymentMethod && !(await listCards(customer)).some((c) => c.id === paymentMethod)) throw new BookingError("NOT_ALLOWED", "That card isn't yours.");
    const intent = await createHoldIntent({ share: charge.amount, customer, paymentMethod, description: `${charge.name}. ${charge.description}`, metadata: { roomId, legId, riderId: actor.id } });
    await bookingStore().upsertPayment({ roomId, legId, riderId: actor.id, provider: "stripe", sessionId: null, paymentIntentId: intent.id, amount: charge.amount, status: "pending", captureBefore: null, offerId: charge.offerId });
    return { ok: true, clientSecret: intent.client_secret };
  } catch (e) {
    return failure(e);
  }
}

/** The browser confirmed the hold (or Stripe's webhook says so): record it, which books the leg once it's the last. */
export async function confirmCardHold(paymentIntentId: string): Promise<boolean> {
  const store = bookingStore();
  const row = await store.findPaymentByIntent(paymentIntentId);
  if (!row) return false;
  if (row.status === "held" || row.status === "captured") return true;
  if (row.status !== "pending") return false;
  const intent = await getPaymentIntent(paymentIntentId);
  if (intent.status !== "requires_capture" && intent.status !== "succeeded") return false;
  await store.upsertPayment({ ...row, status: intent.status === "succeeded" ? "captured" : "held", captureBefore: captureBefore(intent) });
  await recordHold(row.roomId, row.legId, row.riderId);
  return true;
}

/** The rider's pending in-app hold on this leg, to confirm after the browser is done with it. */
export async function pendingIntent(roomId: string, legId: string, riderId: string): Promise<string | null> {
  const row = await bookingStore().getPayment(roomId, legId, riderId);
  return row?.provider === "stripe" && !row.sessionId ? row.paymentIntentId : null;
}

/** A person's saved traveller details. */
export const savedTraveller = (personId: string) => bookingStore().getProfile(personId);

/** Saves what a person typed as their traveller details for next time. A passport is kept when they gave one. */
export async function saveTraveller(personId: string, input: unknown): Promise<{ ok: true; details: TravellerDetails } | Failure> {
  const withPassport = !!(input as { passport?: unknown } | null)?.passport;
  const parsed = travellerSchema(withPassport).safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID", message: "Check the highlighted fields.", fields: [...new Set(parsed.error.issues.map((i) => i.path.join(".")))] };
  const details = parsed.data as TravellerDetails;
  await bookingStore().putProfile(personId, details);
  return { ok: true, details };
}

/** The rider's saved details, used for this leg as they are. */
export async function submitSavedDetails(roomId: string, legId: string, actor: Actor): Promise<{ ok: true } | Failure> {
  const saved = await savedTraveller(actor.id);
  if (!saved) return { ok: false, code: "WRONG_STATE", message: "No saved details yet." };
  return submitDetails(roomId, legId, actor, saved);
}

/**
 * A Checkout session finished: from the return visit or the webhook, whichever comes first. The PaymentIntent, not
 * the session, says whether the card is held. Returns where to send the rider.
 */
export async function confirmCheckout(sessionId: string): Promise<{ roomId: string; legId: string } | null> {
  const store = bookingStore();
  const row = await store.findPaymentBySession(sessionId);
  if (!row) return null;
  const where = { roomId: row.roomId, legId: row.legId };
  if (row.status !== "pending") return where;
  try {
    const session = await getCheckoutSession(sessionId);
    if (!session.payment_intent) return where;
    const intent = await getPaymentIntent(session.payment_intent);
    if (intent.status !== "requires_capture" && intent.status !== "succeeded") return where;
    await store.upsertPayment({ ...row, paymentIntentId: intent.id, status: intent.status === "succeeded" ? "captured" : "held", captureBefore: captureBefore(intent) });
    await recordHold(row.roomId, row.legId, row.riderId);
  } catch (e) {
    console.warn("[booking] confirm checkout failed", isBookingError(e) ? e.code : e);
  }
  return where;
}

/** Stripe says a hold is gone (expired or cancelled outside the app): the seat is unpaid again. */
export async function intentCancelled(paymentIntentId: string) {
  const store = bookingStore();
  const row = await store.findPaymentByIntent(paymentIntentId);
  if (!row || row.status === "captured" || row.status === "cancelled") return;
  await store.upsertPayment({ ...row, status: "cancelled" });
  const { leg } = await readLeg(row.roomId, row.legId);
  if (leg?.booking?.status === "paying" && leg.booking.mode === "group") await updateSeat(row.roomId, row.legId, row.riderId, { paid: false });
}

/** A rider's card is held. Group: mark the seat and buy when it's the last. Separate: buy this seat now. */
async function recordHold(roomId: string, legId: string, riderId: string) {
  const store = bookingStore();
  const row = await store.getPayment(roomId, legId, riderId);
  const { leg } = await readLeg(roomId, legId);
  const booking = leg?.booking;
  if (!row || row.status !== "held") return;
  if (!booking || booking.status !== "paying" || !booking.seats[riderId]) {
    // the settle was cancelled or lapsed while they were paying: give the money back
    if (row.provider === "stripe" && row.paymentIntentId) await cancelPayment(row.paymentIntentId).catch(() => {});
    await store.upsertPayment({ ...row, status: "cancelled" });
    return;
  }
  if (booking.mode === "separate") return buySeat(roomId, legId, riderId);
  // a card hold shorter than the airline's window pulls the deadline in
  const deadline = bookingDeadline({ paymentRequiredBy: booking.deadline, captureBefore: [row.captureBefore] }, 0) ?? booking.deadline;
  await liveblocks().mutateStorage(roomId, ({ root }) => {
    const l = root.get("legs").get(legId);
    const b = l?.get("booking");
    if (!l || !b || !b.seats[riderId]) return;
    l.set("booking", { ...b, deadline: row.captureBefore ? bookingDeadline({ paymentRequiredBy: b.deadline, captureBefore: [row.captureBefore] }, 0) ?? deadline : b.deadline, seats: { ...b.seats, [riderId]: { ...b.seats[riderId], paid: true } } });
  });
  const after = await readLeg(roomId, legId);
  if (after.leg?.booking && allPaid(after.leg.booking.seats)) await purchase(roomId, legId);
}

/**
 * Group: everyone's card is held, so pay the airline from our balance and take each share. Runs once per leg: a
 * retried webhook or a second tab finds the lease taken or the order paid.
 */
async function purchase(roomId: string, legId: string) {
  const store = bookingStore();
  const key = `purchase:${roomId}/${legId}`;
  if (!(await store.acquire(key, LEASE_MS))) return;
  try {
    const { leg } = await readLeg(roomId, legId);
    const booking = leg?.booking;
    if (!booking || booking.status !== "paying" || !booking.orderId || !allPaid(booking.seats)) return;
    const riders = Object.keys(booking.seats);
    const rows = Object.fromEntries((await store.listPayments(roomId, legId)).map((r) => [r.riderId, r]));
    if (riders.some((r) => !rows[r] || (rows[r].status !== "held" && rows[r].status !== "captured"))) return;

    let order = await getOrder(booking.orderId);
    if (order.cancelledAt) return rollback(roomId, legId, booking, "The airline released the seats. Nobody was charged.");
    if (order.awaitingPayment) {
      if (over(order.total, booking.total)) {
        return rollback(roomId, legId, booking, `The price rose to ${money(order.total)} after the guarantee ended. Nobody was charged; settle again if you still want it.`);
      }
      try {
        await payOrder(order, `${booking.orderId}:pay`);
      } catch {
        await payOrder(order, `${booking.orderId}:pay`);
      }
      order = await getOrder(booking.orderId);
    }

    // the airline was paid: now take each share, the lower of what was held and what the order cost
    const shares = splitShares(order.total.amount < booking.total.amount ? order.total : booking.total, riders, booking.settledBy);
    const owed: string[] = [];
    for (const r of riders) {
      const row = rows[r];
      if (row.status === "captured") continue;
      const amount = shares[r].amount < row.amount.amount ? shares[r] : row.amount;
      try {
        if (row.provider === "stripe" && row.paymentIntentId) await capturePayment(row.paymentIntentId, amount, `${roomId}:${legId}:${r}:capture`);
        await store.upsertPayment({ ...row, amount, status: "captured" });
      } catch (e) {
        console.warn("[booking] capture failed", isBookingError(e) ? e.code : e);
        await store.upsertPayment({ ...row, status: "failed" });
        owed.push(r);
      }
    }
    const booked: LegBooking = {
      ...booking,
      status: "booked",
      total: order.total,
      reference: order.reference,
      deadline: null,
      seats: Object.fromEntries(riders.map((r) => [r, { ...booking.seats[r], share: shares[r], paid: true }])),
    };
    const names = (await readLeg(roomId, legId)).plan.members ?? {};
    await writeBooking(roomId, legId, booked, owed.length ? `Booked. ${owed.map((r) => names[r]?.name ?? "A rider").join(", ")}'s card couldn't be charged, so their share is still owed.` : null);
  } catch (e) {
    console.warn("[booking] purchase failed", isBookingError(e) ? e.code : e);
    const { leg } = await readLeg(roomId, legId);
    if (leg?.booking?.status === "paying") await rollback(roomId, legId, leg.booking, "Paying the airline failed. Nobody was charged; settle again when you're ready.");
  } finally {
    await store.release(key);
  }
}

/** Separate tickets: the rider's card is held, so buy their one seat and take the money. */
async function buySeat(roomId: string, legId: string, riderId: string) {
  const store = bookingStore();
  const key = `seat:${roomId}/${legId}/${riderId}`;
  if (!(await store.acquire(key, LEASE_MS))) return;
  const release = async (row: PaymentRow) => {
    if (row.provider === "stripe" && row.paymentIntentId) await cancelPayment(row.paymentIntentId).catch(() => {});
    await store.upsertPayment({ ...row, status: "cancelled" });
  };
  try {
    const { plan, leg } = await readLeg(roomId, legId);
    const booking = leg?.booking;
    const seat = booking?.seats[riderId];
    const row = await store.getPayment(roomId, legId, riderId);
    if (!booking || !seat || !row || row.status !== "held" || seat.paid) return;
    const who = plan.members?.[riderId]?.name ?? "A rider";
    const traveller = (await store.getTravellers(roomId, legId))[riderId];
    if (!traveller) {
      await release(row);
      await updateSeat(roomId, legId, riderId, { details: false });
      await writeBooking(roomId, legId, (await readLeg(roomId, legId)).leg?.booking ?? null, `${who}: enter your details again and pay; the card wasn't charged.`);
      return;
    }
    let offer = row.offerId ? await getOffer(row.offerId).catch(() => null) : null;
    if (!offer || offerExpired(offer)) offer = await currentOffer(booking, 1);
    if (!offer) {
      await release(row);
      await writeBooking(roomId, legId, booking, `${who}: that flight is gone; the card wasn't charged.`);
      return;
    }
    if (over(offer.total, row.amount)) {
      await release(row);
      await writeBooking(roomId, legId, booking, `${who}: the price rose to ${money(offer.total)}; the card wasn't charged. Pay again to take it.`);
      return;
    }
    let order;
    try {
      order = await createOrder({ offer, travellers: [traveller], type: "instant", idempotencyKey: `${roomId}:${legId}:${riderId}:${row.sessionId ?? row.updatedAt}:buy`, metadata: { room: roomId, leg: legId, rider: riderId } });
    } catch (e) {
      const f = failure(e);
      await release(row);
      await writeBooking(roomId, legId, booking, `${who}: ${f.message} The card wasn't charged.`);
      return;
    }
    let charged = true;
    try {
      if (row.provider === "stripe" && row.paymentIntentId) await capturePayment(row.paymentIntentId, order.total, `${roomId}:${legId}:${riderId}:capture`);
      await store.upsertPayment({ ...row, amount: order.total, status: "captured" });
    } catch (e) {
      console.warn("[booking] capture failed", isBookingError(e) ? e.code : e);
      await store.upsertPayment({ ...row, status: "failed" });
      charged = false;
    }
    await store.deleteTravellers(roomId, legId, riderId);
    await liveblocks().mutateStorage(roomId, ({ root }) => {
      const l = root.get("legs").get(legId);
      const b = l?.get("booking");
      if (!l || !b || !b.seats[riderId]) return;
      const seats = { ...b.seats, [riderId]: { ...b.seats[riderId], share: order.total, paid: true, orderId: order.id, reference: order.reference } };
      const total = { amount: Object.values(seats).reduce((s, x) => s + x.share.amount, 0), currency: order.total.currency };
      l.set("booking", { ...b, seats, total, status: allPaid(seats) ? "booked" : b.status });
      if (!charged) l.set("bookingNotice", `${who} has a ticket, but the card couldn't be charged, so their share is still owed.`);
    });
    await trackActive(roomId, legId, (await readLeg(roomId, legId)).leg?.booking ?? null);
  } finally {
    await store.release(key);
  }
}

/** Group bookings past their deadline go back to planning: holds released, nobody charged. Call on reads of a trip. */
export async function expireBookings(roomId: string, now = Date.now()) {
  let plan: PlanJson;
  try {
    plan = (await liveblocks().getStorageDocument(roomId, "json")) as PlanJson;
  } catch {
    return;
  }
  for (const [legId, leg] of Object.entries(plan.legs ?? {})) {
    const b = leg.booking;
    if (!b || b.status === "booked" || !b.deadline || Date.parse(b.deadline) > now) continue;
    await rollback(roomId, legId, b, b.status === "details" ? "The settle lapsed before everyone entered their details." : "The deadline passed before everyone paid. Nobody was charged.");
  }
}

/**
 * The scheduled sweep: every leg with a booking in progress, whether or not anyone has the trip open. Expires what
 * is past its deadline and drops legs that are booked or gone from the list. Returns what it looked at.
 */
export async function sweepBookings(now = Date.now()): Promise<{ rooms: number; legs: number; expired: number }> {
  const store = bookingStore();
  const active = await store.listActive();
  const byRoom = new Map<string, string[]>();
  for (const { roomId, legId } of active) byRoom.set(roomId, [...(byRoom.get(roomId) ?? []), legId]);
  let expired = 0;
  for (const [roomId, legIds] of byRoom) {
    let plan: PlanJson | null = null;
    try {
      plan = (await liveblocks().getStorageDocument(roomId, "json")) as PlanJson;
    } catch (error) {
      // Only a confirmed missing room is safe to forget. Retry transient failures on the next sweep.
      if (!(error instanceof Error && "status" in error && error.status === 404)) continue;
    }
    for (const legId of legIds) {
      const b = plan?.legs?.[legId]?.booking;
      if (!b || b.status === "booked") {
        await store.clearActive(roomId, legId).catch(() => {});
        continue;
      }
      if (!b.deadline || Date.parse(b.deadline) > now) continue;
      await rollback(roomId, legId, b, b.status === "details" ? "The settle lapsed before everyone entered their details." : "The deadline passed before everyone paid. Nobody was charged.");
      expired++;
    }
  }
  return { rooms: byRoom.size, legs: active.length, expired };
}

/** Clears the message a stopped booking left on the leg. */
export async function dismissNotice(roomId: string, legId: string) {
  await liveblocks().mutateStorage(roomId, ({ root }) => root.get("legs").get(legId)?.set("bookingNotice", null));
}

/** Where a rider's own seat stands, for a checkout that walks one rider through it. Null before a settle. */
export async function seatStep(roomId: string, legId: string, actorId: string): Promise<{ step: "details" | "pay" | "wait" | "done"; documents: boolean; share: Money } | null> {
  const { leg } = await readLeg(roomId, legId);
  const booking = leg?.booking;
  const seat = booking?.seats[actorId];
  if (!booking || !seat) return null;
  const step = seat.paid || booking.status === "booked" ? "done" : !seat.details ? "details" : booking.status === "paying" ? "pay" : "wait";
  return { step, documents: booking.documents, share: seat.share };
}

/** Why a leg went back to planning, when it did. */
export async function bookingNoticeOf(roomId: string, legId: string): Promise<string | null> {
  return (await readLeg(roomId, legId)).leg?.bookingNotice ?? null;
}
