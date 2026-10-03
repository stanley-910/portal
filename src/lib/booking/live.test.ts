import { describe, expect, it } from "vitest";

import type { PlanJson } from "@/lib/agent/snapshot";
import { liveblocks } from "@/lib/liveblocks/server";
import type { LegBooking } from "@/lib/liveblocks/types";
import { duffel } from "@/lib/transport/providers/duffel";
import { toStoredOffer } from "@/lib/trip/offers";
import { toStorageLson } from "@/lib/trip/server";

import { cancelOrder } from "./duffel";
import { cancelSettle, expireBookings, settleLeg, startPayment, submitDetails } from "./flow";

const date = new Date(Date.now() + 25 * 864e5).toISOString().slice(0, 10);
const ann = { id: "u_ann", name: "Ann", email: "ann@example.com" };
const bo = { id: "u_bo", name: "Bo", email: "bo@example.com" };
const details = (given: string, born: string) => ({ title: "ms", gender: "f", givenName: given, familyName: "Traveller", bornOn: born, email: `${given.toLowerCase()}@example.com`, phone: "+85291234567" });

const read = async (roomId: string) => ((await liveblocks().getStorageDocument(roomId, "json")) as PlanJson).legs!.leg1;

// The scripted run from docs/booking/README.md. It makes a real room and test-mode Duffel orders, so it's opt-in:
//   BOOKING_LIVE=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run src/lib/booking/live.test.ts
// Needs LIVEBLOCKS_SECRET_KEY and a test DUFFEL_ACCESS_TOKEN; without STRIPE_SECRET_KEY it uses the test checkout.
const live = process.env.BOOKING_LIVE === "1" && !!process.env.LIVEBLOCKS_SECRET_KEY && !!process.env.DUFFEL_ACCESS_TOKEN;

describe("booking flow live (Liveblocks + Duffel test mode)", () => {
  it.skipIf(!live)("group: settle → details → holds → purchase → booked; then separate, expiry and cancel", async () => {
    const lb = liveblocks();
    const offers = await duffel.search(
      { from: { name: "Hong Kong", lat: 22.308, lng: 113.918, iata: "HKG" }, to: { name: "Shanghai", lat: 31.143, lng: 121.805, iata: "PVG" }, date, modes: ["flight"], passengers: 1, currency: "USD" },
      new AbortController().signal,
    );
    const stored = offers.slice(0, 3).map(toStoredOffer);
    const id = "livetest" + Math.random().toString(36).slice(2, 10);
    const roomId = `trip:${id}`;
    await lb.createRoom(roomId, { defaultAccesses: [], usersAccesses: { [ann.id]: ["room:write"], [bo.id]: ["room:write"] }, metadata: { members: [ann.id, bo.id], title: "Live test" } });
    await lb.initializeStorageDocument(
      roomId,
      toStorageLson({
        members: { [ann.id]: { name: "Ann", color: 1 }, [bo.id]: { name: "Bo", color: 2 } },
        stops: { hkg: { lat: 22.308, lng: 113.918, hub: null, code: "HKG", name: "Hong Kong" }, pvg: { lat: 31.143, lng: 121.805, hub: null, code: "PVG", name: "Shanghai" } },
        legs: { leg1: { from: "hkg", to: "pvg", date, createdBy: ann.id, riders: [ann.id, bo.id], search: { id: "s1", status: "done", offers: stored }, votes: {}, chosen: stored[0].id, createdAt: 1 } },
      }),
    );
    try {
      // settle: the group price is per seat × 2, which may differ a little from the single-seat quote
      let settled = await settleLeg(roomId, "leg1", ann);
      if (!settled.ok && "now" in settled) {
        settled = await settleLeg(roomId, "leg1", ann, settled.now);
      }
      expect(settled).toMatchObject({ ok: true, mode: "group" });
      let leg = await read(roomId);
      expect(leg.booking).toMatchObject({ mode: "group", status: "details", settledBy: ann.id });
      expect(Object.keys(leg.booking!.seats)).toEqual([ann.id, bo.id]);

      // the wrong person, bad details, then the right ones
      expect(await submitDetails(roomId, "leg1", { id: "u_cy", name: "Cy", email: null }, details("Cy", "1990-01-01"))).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
      expect(await submitDetails(roomId, "leg1", ann, { ...details("Ann", "1990-01-01"), phone: "123" })).toMatchObject({ ok: false, code: "INVALID", fields: ["phone"] });
      expect(await submitDetails(roomId, "leg1", ann, details("Ann", "1990-01-01"))).toEqual({ ok: true });
      leg = await read(roomId);
      expect(leg.booking!.status).toBe("details");
      expect(leg.booking!.seats[ann.id].details).toBe(true);
      // paying before the hold is refused
      expect(await startPayment(roomId, "leg1", ann, "http://localhost:3010")).toMatchObject({ ok: false, code: "WRONG_STATE" });

      expect(await submitDetails(roomId, "leg1", bo, details("Bo", "1992-02-02"))).toEqual({ ok: true });
      leg = await read(roomId);
      expect(leg.booking).toMatchObject({ status: "paying" });
      expect(leg.booking!.orderId).toMatch(/^ord_/);
      expect(leg.booking!.deadline).toBeTruthy();
      const orderId = leg.booking!.orderId!;

      // the no-charge test checkout holds at once
      expect(await startPayment(roomId, "leg1", ann, "http://localhost:3010")).toEqual({ ok: true, url: null });
      leg = await read(roomId);
      expect(leg.booking).toMatchObject({ status: "paying", seats: { [ann.id]: { paid: true }, [bo.id]: { paid: false } } });
      // cancelling once someone has paid is refused
      expect(await cancelSettle(roomId, "leg1", bo)).toMatchObject({ ok: false, code: "WRONG_STATE" });
      expect(await startPayment(roomId, "leg1", bo, "http://localhost:3010")).toEqual({ ok: true, url: null });
      leg = await read(roomId);
      expect(leg.booking).toMatchObject({ status: "booked", orderId });
      expect(leg.booking!.reference).toBeTruthy();
      expect(Object.values(leg.booking!.seats).every((s) => s.paid)).toBe(true);
      expect(await startPayment(roomId, "leg1", bo, "http://localhost:3010")).toMatchObject({ ok: false, code: "WRONG_STATE" });
      await cancelOrder(orderId);

      // separate tickets: written straight in, then one rider buys a seat (an instant order)
      const sep: LegBooking = { ...leg.booking!, mode: "separate", status: "paying", orderId: null, reference: null, deadline: null, seats: { [ann.id]: { share: leg.booking!.seats[ann.id].share, details: false, paid: false }, [bo.id]: { share: leg.booking!.seats[bo.id].share, details: false, paid: false } } };
      await lb.mutateStorage(roomId, ({ root }) => root.get("legs").get("leg1")!.set("booking", sep));
      expect(await startPayment(roomId, "leg1", ann, "http://localhost:3010")).toMatchObject({ ok: false, code: "WRONG_STATE" });
      expect(await submitDetails(roomId, "leg1", ann, details("Ann", "1990-01-01"))).toEqual({ ok: true });
      const paid = await startPayment(roomId, "leg1", ann, "http://localhost:3010");
      leg = await read(roomId);
      if (paid.ok) {
        expect(leg.booking!.seats[ann.id]).toMatchObject({ paid: true });
        expect(leg.booking!.seats[ann.id].reference).toBeTruthy();
        expect(leg.booking!.status).toBe("paying");
        await cancelOrder(leg.booking!.seats[ann.id].orderId!);
      } else {
        // a one-seat price above the two-seat share: the group sees it first
        expect(paid).toMatchObject({ code: "PRICE_CHANGED" });
      }

      // expiry: a deadline in the past sends the leg back to planning with a notice
      await lb.mutateStorage(roomId, ({ root }) => root.get("legs").get("leg1")!.set("booking", { ...sep, mode: "group", deadline: new Date(Date.now() - 1000).toISOString() }));
      await expireBookings(roomId);
      leg = await read(roomId);
      expect(leg.booking).toBeNull();
      expect(leg.bookingNotice).toMatch(/deadline passed/);

      // settle again and cancel while nobody has paid
      let again = await settleLeg(roomId, "leg1", bo);
      if (!again.ok && "now" in again) again = await settleLeg(roomId, "leg1", bo, again.now);
      expect(again).toMatchObject({ ok: true });
      expect((await read(roomId)).bookingNotice).toBeNull();
      expect(await cancelSettle(roomId, "leg1", ann)).toEqual({ ok: true });
      expect((await read(roomId)).booking).toBeNull();
    } finally {
      await lb.deleteRoom(roomId).catch(() => {});
    }
  }, 180_000);
});
