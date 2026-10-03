import { describe, expect, it } from "vitest";

import { bookingTarget } from "@/app/use-book-after-save";
import type { Offer } from "@/lib/transport/types";
import { buildSoloStorage, soloSaveSchema } from "@/lib/trip/server";

import { matchOffer } from "./offer";
import { refusedPassenger, settleReady, storedFlights } from "./ready";

// A leg saved from the home globe with a Duffel pick must arrive in its room ready to settle: the saver rides it, its
// search is done (so the room doesn't search again and drop the pick), and the pick keeps what settling matches on.

const day = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const hkg = { name: "Hong Kong", lat: 22.308, lng: 113.918, iata: "HKG" };
const pvg = { name: "Shanghai", lat: 31.143, lng: 121.805, iata: "PVG" };

/** As the Duffel provider maps it: local times with their offset, the marketing flight number. */
const duffelOffer: Offer = {
  id: "duffel:off_0000AoqGfP1mD0Kp3cHk1",
  provider: "duffel",
  mode: "flight",
  kind: "live",
  segments: [{ mode: "flight", carrier: "Cathay Pacific", number: "CX364", from: hkg, to: pvg, depart: `${day}T08:00:00+08:00`, arrive: `${day}T10:35:00+08:00`, durationMin: 155 }],
  price: { amount: 412.6, currency: "USD" },
  attribution: "Duffel — live fare from Cathay Pacific",
};
const cachedOffer: Offer = {
  ...duffelOffer,
  id: "travelpayouts:CX364",
  provider: "travelpayouts",
  kind: "cached",
  bookingUrl: "https://www.aviasales.com/search/HKG1511PVG1",
  attribution: "Travelpayouts / Aviasales — cached fare",
};

/** A fresh Duffel search result for the same flight, as `findOfferFor` would get it. */
const fresh = (number = "364") => ({
  id: "off_fresh",
  total_amount: "820.00",
  total_currency: "USD",
  expires_at: `${day}T00:00:00Z`,
  owner: { name: "Cathay Pacific" },
  passengers: [{ id: "pas_1" }, { id: "pas_2" }],
  payment_requirements: { requires_instant_payment: false },
  slices: [{ segments: [{ marketing_carrier: { iata_code: "CX", name: "Cathay Pacific" }, marketing_carrier_flight_number: number, departing_at: `${day}T08:00:00`, arriving_at: `${day}T10:35:00`, origin: { iata_code: "HKG" }, destination: { iata_code: "PVG" } }] }],
});

const saver = { id: "user-1", displayName: "Mei" };
let n = 0;
const ids = () => `id${n++}`;

function saved(chosen: string) {
  // through the schema the save action uses, so nothing settling needs is stripped on the way in
  const input = soloSaveSchema.parse({
    legs: [{ from: { ...hkg, hub: "HKG", code: "HKG" }, to: { ...pvg, hub: "PVG", code: "PVG" }, date: day, offers: [cachedOffer, duffelOffer], chosen }],
  });
  const storage = buildSoloStorage(input, saver, ids, Date.now());
  const [legId, leg] = Object.entries(storage.legs)[0];
  return { input, storage, legId, leg };
}

describe("a solo-saved leg with a Duffel pick", () => {
  it("is ready to settle for the saver", () => {
    const { leg } = saved(duffelOffer.id);
    expect(leg.riders).toEqual([saver.id]);
    // a done search is left alone when the room opens; only edits search again
    expect(leg.search.status).toBe("done");
    const ready = settleReady(leg, saver.id);
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(ready.offerId).toBe("off_0000AoqGfP1mD0Kp3cHk1");
    expect(ready.chosen.flights).toEqual([{ number: "CX364", from: "HKG", to: "PVG", depart: `${day}T08:00:00+08:00` }]);
  });

  it("keeps the flights to find again once Duffel has dropped the offer", () => {
    const { leg } = saved(duffelOffer.id);
    const ready = settleReady(leg, saver.id);
    if (!ready.ok) throw ready.error;
    const like = storedFlights(ready.chosen);
    expect(like).toMatchObject({ origin: "HKG", destination: "PVG", date: day });
    expect(matchOffer(like!, [fresh()], 2)?.id).toBe("off_fresh");
    expect(matchOffer(like!, [fresh("365")], 2)).toBeNull();
  });

  it("isn't settled by a member who doesn't ride it, or on a pick bought elsewhere", () => {
    expect(settleReady(saved(duffelOffer.id).leg, "someone-else")).toMatchObject({ ok: false, error: { code: "NOT_ALLOWED" } });
    expect(settleReady(saved(cachedOffer.id).leg, saver.id)).toMatchObject({ ok: false, error: { code: "WRONG_STATE" } });
  });

  it("checks out the saved trip at that leg", () => {
    const { input, legId } = saved(duffelOffer.id);
    expect(bookingTarget({ id: "trip123", legs: [legId] }, input)).toEqual({ tripId: "trip123", legId });
    expect(bookingTarget({ id: "trip123", legs: [legId] }, saved(cachedOffer.id).input)).toBeNull();
  });
});

describe("refusedPassenger", () => {
  const riders = ["ada", "mei", "joon"];
  it("names the rider whose field Duffel refused, in rider order", () => {
    expect(refusedPassenger("/passengers/1/phone_number", riders)).toEqual({ rider: "mei", field: "phone number" });
    expect(refusedPassenger("/passengers/2/identity_documents/0/expires_on", riders)).toEqual({ rider: "joon", field: "expires on" });
  });
  it("is null for an error about the order itself or an unknown passenger", () => {
    expect(refusedPassenger("/payments/0/amount", riders)).toBeNull();
    expect(refusedPassenger("/passengers/7/email", riders)).toBeNull();
    expect(refusedPassenger(undefined, riders)).toBeNull();
  });
});
