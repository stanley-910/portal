"use server";

import { randomBytes } from "node:crypto";

import { redirect } from "next/navigation";

import { ensureGuest, MAX_NAME, readGuest, setGuestName } from "@/lib/guest";
import { liveblocks } from "@/lib/liveblocks/server";
import { TRIP_ID, tripRoomId, type LegSearch, type Stop } from "@/lib/liveblocks/types";
import { fanOut } from "@/lib/transport/search";
import { MAX_OFFERS, toStoredOffer } from "@/lib/trip/offers";

/** Creates a trip room owned by the current guest and opens it. Its URL is the invite (M7). */
export async function createTrip() {
  const guest = await ensureGuest();
  const id = randomBytes(12).toString("base64url");
  await liveblocks().createRoom(tripRoomId(id), {
    defaultAccesses: [],
    usersAccesses: { [guest.id]: ["room:write"] },
    metadata: { members: [guest.id] },
  });
  redirect(`/t/${id}`);
}

/** Saves the name others see on your cursor and avatar. */
export async function saveName(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().slice(0, MAX_NAME);
  await ensureGuest();
  if (name) await setGuestName(name);
}

/**
 * Runs the route search for one leg and writes the results into the trip for everyone (M13). It runs on the server so
 * provider keys stay there (ADR-C01) and the results land even if whoever drew the leg closes the tab. `searchId` is
 * the search the caller started: if the leg was edited since, a newer search owns it and this one is dropped (M12).
 */
export async function searchLeg(tripId: string, legId: string, searchId: string) {
  if (!TRIP_ID.test(tripId)) return;
  const roomId = tripRoomId(tripId);
  const guest = await readGuest();
  const lb = liveblocks();
  const room = await lb.getRoom(roomId).catch(() => null);
  // the search spends provider quota, so only members can start one
  if (!guest || !room?.usersAccesses[guest.id]) return;

  const plan = await lb.getStorageDocument(roomId, "json");
  const leg = plan.legs?.[legId];
  const from = leg && plan.stops?.[leg.from];
  const to = leg && plan.stops?.[leg.to];
  if (!leg || !from || !to || leg.search.id !== searchId) return;

  const place = (s: Stop) => ({ name: s.name, lat: s.lat, lng: s.lng, iata: s.hub });
  let search: LegSearch;
  try {
    const result = await fanOut({
      from: place(from),
      to: place(to),
      date: leg.date,
      modes: [],
      passengers: 1,
      currency: "USD",
    });
    search = { id: searchId, status: "done", offers: result.offers.slice(0, MAX_OFFERS).map(toStoredOffer) };
  } catch {
    search = { id: searchId, status: "failed", offers: [] };
  }

  await lb.mutateStorage(roomId, ({ root }) => {
    const current = root.get("legs").get(legId);
    if (current?.get("search").id === searchId) current.set("search", search);
  });
}
