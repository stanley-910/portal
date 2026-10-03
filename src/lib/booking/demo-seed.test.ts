import { expect, it } from "vitest";

import { liveblocks } from "@/lib/liveblocks/server";
import { duffel } from "@/lib/transport/providers/duffel";
import { toStoredOffer } from "@/lib/trip/offers";
import { toStorageLson } from "@/lib/trip/server";

// Opt-in helper: seeds a trip for the Stripe checkout rehearsal, guests g_demoAnn and g_demoBo riding one leg.
const run = process.env.BOOKING_SEED === "1";
const date = new Date(Date.now() + 25 * 864e5).toISOString().slice(0, 10);

it.skipIf(!run)("seeds a demo trip", async () => {
  const lb = liveblocks();
  const offers = await duffel.search(
    { from: { name: "Hong Kong", lat: 22.308, lng: 113.918, iata: "HKG" }, to: { name: "Shanghai", lat: 31.143, lng: 121.805, iata: "PVG" }, date, modes: ["flight"], passengers: 1, currency: "USD" },
    new AbortController().signal,
  );
  expect(offers.length).toBeGreaterThan(0);
  const stored = offers.slice(0, 3).map((offer) => toStoredOffer({ ...offer, kind: "live" }));
  const id = ("demo" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 16);
  const ann = "g_demoAnn";
  const bo = "g_demoBo";
  await lb.createRoom(`trip:${id}`, { defaultAccesses: [], usersAccesses: { [ann]: ["room:write"], [bo]: ["room:write"] }, metadata: { members: [ann, bo], title: "Checkout rehearsal", owner: ann } });
  await lb.initializeStorageDocument(
    `trip:${id}`,
    toStorageLson({
      members: { [ann]: { name: "Ann", color: 1 }, [bo]: { name: "Bo", color: 2 } },
      stops: { hkg: { lat: 22.308, lng: 113.918, hub: null, code: "HKG", name: "Hong Kong" }, pvg: { lat: 31.143, lng: 121.805, hub: null, code: "PVG", name: "Shanghai" } },
      legs: { leg1: { from: "hkg", to: "pvg", date, createdBy: ann, riders: [ann, bo], search: { id: "s1", status: "done", offers: stored }, votes: {}, chosen: stored[0].id, createdAt: 1 } },
    }),
  );
  console.log(`TRIP_ID=${id}`);
}, 60_000);
