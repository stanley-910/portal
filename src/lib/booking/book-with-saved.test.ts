import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlanJson } from "@/lib/agent/snapshot";
import type { LegBooking } from "@/lib/liveblocks/types";

import type { BookableOffer } from "./offer";
import type { BookingStore } from "./store";

// bookWithSaved end to end on one leg: the room is an in-memory plan, the store is the memory store, and Duffel and
// Stripe are mocked at their modules.
const h = vi.hoisted(() => ({ plan: {} as PlanJson, store: null as unknown as BookingStore }));
const duffel = vi.hoisted(() => ({ getOffer: vi.fn(), findOfferFor: vi.fn(), createOrder: vi.fn(), getOrder: vi.fn(), payOrder: vi.fn(), cancelOrder: vi.fn() }));
const stripe = vi.hoisted(() => ({ listCards: vi.fn(), createCustomer: vi.fn(), createHoldIntent: vi.fn(), confirmSavedHold: vi.fn(), getPaymentIntent: vi.fn(), cancelPayment: vi.fn(), capturePayment: vi.fn() }));

vi.mock("@/lib/env.server", async (orig) => ({ env: { ...(await orig<typeof import("@/lib/env.server")>()).env, DUFFEL_ACCESS_TOKEN: "duffel_test_x", STRIPE_SECRET_KEY: "sk_test_x" } }));
vi.mock("@/lib/liveblocks/server", () => {
  // root.get("legs").get(id) and root.get("members").get(id): plain objects behind get/set
  const node = (o: Record<string, unknown>) => ({ get: (k: string) => o[k], set: (k: string, v: unknown) => void (o[k] = v) });
  const root = { get: (k: "legs" | "members") => ({ get: (id: string) => { const o = (h.plan[k] as Record<string, Record<string, unknown>> | undefined)?.[id]; return o && node(o); } }) };
  return { liveblocks: () => ({ getStorageDocument: async () => structuredClone(h.plan), mutateStorage: async (_: string, fn: (s: { root: typeof root }) => void) => fn({ root }) }) };
});
vi.mock("./duffel", () => duffel);
vi.mock("./stripe", async (orig) => ({ ...(await orig<typeof import("./stripe")>()), ...stripe }));
vi.mock("./store", async (orig) => ({ ...(await orig<typeof import("./store")>()), bookingStore: () => h.store }));

import { bookWithSaved } from "./flow";
import { memoryBookingStore } from "./store";

const room = "trip:t1";
const ann = { id: "u_ann", name: "Ann", email: "ann@example.com" };
const usd = (amount: number) => ({ amount, currency: "USD" });
const future = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();
const flights = [{ number: "CX1", from: "HKG", to: "PVG", departingAt: "2026-11-01T08:00:00" }];
const traveller = { title: "ms", gender: "f", givenName: "Ann", familyName: "Traveller", bornOn: "1990-01-01", email: "ann@example.com", phone: "+85291234567", passport: null } as const;
const card = { id: "pm_1", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 };

const offer: BookableOffer = {
  id: "off_1", total: usd(100), passengerIds: ["pas_1"], expiresAt: future(1), airline: "CX", documentsRequired: false, instantOnly: false,
  paymentRequiredBy: null, priceGuaranteeExpiresAt: null, origin: "HKG", destination: "PVG", date: "2026-11-01", flights: flights.map((f) => ({ ...f, arrivingAt: f.departingAt })),
};
const order = (awaitingPayment: boolean) => ({ id: "ord_1", reference: awaitingPayment ? null : "ABC123", total: usd(100), type: "hold", awaitingPayment, paymentRequiredBy: future(48), priceGuaranteeExpiresAt: future(48), cancelledAt: null });

/** A group leg settled for `riders`, Ann still to enter details unless `booking` says otherwise. */
function seed(riders: string[], booking: Partial<LegBooking> = {}) {
  const share = usd(100 / riders.length);
  h.plan = {
    members: Object.fromEntries(riders.map((r, i) => [r, { name: r, color: i + 1 }])),
    legs: { leg: { from: "hkg", to: "pvg", date: "2026-11-01", riders, booking: {
      mode: "group", status: "details", offerId: "off_1", route: { origin: "HKG", destination: "PVG", date: "2026-11-01" }, flights, total: usd(100), documents: false,
      seats: Object.fromEntries(riders.map((r) => [r, { share, details: false, paid: false }])), deadline: future(24), settledBy: ann.id, settledAt: 1, ...booking,
    } } },
  } as unknown as PlanJson;
}
const leg = () => h.plan.legs!.leg;
const payment = () => h.store.getPayment(room, "leg", ann.id);

beforeEach(async () => {
  vi.clearAllMocks();
  h.store = memoryBookingStore();
  await h.store.putProfile(ann.id, traveller);
  await h.store.putCustomer(`test:${ann.id}`, "cus_1");
  duffel.getOffer.mockResolvedValue(offer);
  duffel.createOrder.mockResolvedValue(order(true));
  duffel.getOrder.mockResolvedValueOnce(order(true)).mockResolvedValue(order(false));
  duffel.payOrder.mockResolvedValue(undefined);
  duffel.cancelOrder.mockResolvedValue(undefined);
  stripe.listCards.mockResolvedValue([card]);
  stripe.createHoldIntent.mockResolvedValue({ id: "pi_1", client_secret: "pi_1_secret", status: "requires_confirmation" });
  stripe.confirmSavedHold.mockResolvedValue({ id: "pi_1", client_secret: "pi_1_secret", status: "requires_capture" });
  stripe.getPaymentIntent.mockResolvedValue({ id: "pi_1", status: "requires_capture", latest_charge: null });
  stripe.cancelPayment.mockResolvedValue(undefined);
  stripe.capturePayment.mockResolvedValue(undefined);
});

describe("bookWithSaved", () => {
  it("books a lone rider's seat: details in, seats held, card held, airline paid, share taken", async () => {
    seed([ann.id]);
    expect(await bookWithSaved(room, "leg", ann)).toEqual({ ok: true, done: "booked" });
    expect(duffel.createOrder).toHaveBeenCalledWith(expect.objectContaining({ type: "hold", travellers: [traveller] }));
    expect(stripe.createHoldIntent).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_1", paymentMethod: "pm_1", share: usd(100) }));
    expect(stripe.confirmSavedHold).toHaveBeenCalledWith("pi_1", "pm_1");
    expect(duffel.payOrder).toHaveBeenCalledOnce();
    expect(stripe.capturePayment).toHaveBeenCalledWith("pi_1", usd(100), expect.any(String));
    expect(leg().booking).toMatchObject({ status: "booked", reference: "ABC123", seats: { [ann.id]: { paid: true } } });
    expect(await payment()).toMatchObject({ status: "captured" });
  });

  // regression: a purchase that failed inline used to come back as held
  it("reports a failed airline payment as failed, with the hold released and the leg back in planning", async () => {
    seed([ann.id]);
    duffel.payOrder.mockRejectedValue(new Error("duffel down"));
    expect(await bookWithSaved(room, "leg", ann)).toEqual({ ok: false, code: "PAYMENT_FAILED", message: "Paying the airline failed. Nobody was charged; settle again when you're ready." });
    expect(duffel.payOrder).toHaveBeenCalledTimes(2);
    expect(stripe.cancelPayment).toHaveBeenCalledWith("pi_1");
    expect(stripe.capturePayment).not.toHaveBeenCalled();
    expect(duffel.cancelOrder).toHaveBeenCalledWith("ord_1");
    expect(leg().booking).toBeNull();
    expect(await payment()).toMatchObject({ status: "cancelled" });
  });

  it("holds the seat and stops while others on the leg still owe", async () => {
    seed([ann.id, "u_bo"], { status: "paying", orderId: "ord_1", seats: { [ann.id]: { share: usd(50), details: true, paid: false }, u_bo: { share: usd(50), details: true, paid: false } } });
    expect(await bookWithSaved(room, "leg", ann)).toEqual({ ok: true, done: "held" });
    expect(leg().booking).toMatchObject({ status: "paying", seats: { [ann.id]: { paid: true }, u_bo: { paid: false } } });
    expect(duffel.payOrder).not.toHaveBeenCalled();
    expect(await payment()).toMatchObject({ status: "held" });
  });

  it("asks for details when none are saved", async () => {
    seed([ann.id]);
    h.store = memoryBookingStore();
    expect(await bookWithSaved(room, "leg", ann)).toEqual({ ok: true, needs: "details" });
    expect(duffel.createOrder).not.toHaveBeenCalled();
    expect(leg().booking?.seats[ann.id].details).toBe(false);
  });

  it("asks for a card when none is saved, after putting the saved details in", async () => {
    seed([ann.id]);
    stripe.listCards.mockResolvedValue([]);
    expect(await bookWithSaved(room, "leg", ann)).toEqual({ ok: true, needs: "card" });
    expect(leg().booking).toMatchObject({ status: "paying", orderId: "ord_1", seats: { [ann.id]: { details: true, paid: false } } });
    expect(stripe.createHoldIntent).not.toHaveBeenCalled();
  });

  it("hands 3-D Secure back to the rider with the card it was on", async () => {
    seed([ann.id]);
    stripe.confirmSavedHold.mockResolvedValue({ id: "pi_1", client_secret: "pi_1_secret", status: "requires_action" });
    expect(await bookWithSaved(room, "leg", ann)).toEqual({ ok: true, needs: "authentication", card: "visa ·4242" });
    expect(stripe.getPaymentIntent).not.toHaveBeenCalled();
    expect(await payment()).toMatchObject({ status: "pending", paymentIntentId: "pi_1" });
    expect(leg().booking).toMatchObject({ status: "paying", seats: { [ann.id]: { paid: false } } });
  });
});
