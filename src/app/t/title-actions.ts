"use server";

import { isNotFound, liveblocks } from "@/lib/liveblocks/server";
import { TRIP_ID, tripRoomId } from "@/lib/liveblocks/types";
import { currentPerson } from "@/lib/identity";
import { readPlan } from "@/lib/trip/server";
import { planTitle } from "@/lib/trip/title";

/** Writes the auto title (from the saved plan) into the room's metadata. A no-op unless the caller is a member. */
export async function refreshTripTitle(tripId: string) {
  if (typeof tripId !== "string" || !TRIP_ID.test(tripId)) return;
  try {
    const user = await currentPerson();
    if (!user) return;
    const roomId = tripRoomId(tripId);
    const lb = liveblocks();
    const room = await lb.getRoom(roomId);
    if (!room.usersAccesses[user.id]) return;
    // someone named the trip themselves: the plan no longer names it
    if (room.metadata.titleSet === "1") return;
    const title = planTitle(await readPlan(tripId));
    await lb.updateRoom(roomId, { metadata: { title, updatedAt: new Date().toISOString() } });
  } catch (e) {
    if (!isNotFound(e)) console.warn("refreshTripTitle failed");
  }
}

/** The longest name a trip can be given. */
const MAX_TRIP_TITLE = 80;

/**
 * Names the trip, for everyone in it: from the library's rename. From then on the plan's auto title leaves it alone.
 * An empty name hands the title back to the plan. A no-op unless the caller is a member.
 */
export async function renameTrip(tripId: string, title: string): Promise<{ ok: boolean; title?: string }> {
  if (typeof tripId !== "string" || !TRIP_ID.test(tripId) || typeof title !== "string") return { ok: false };
  try {
    const user = await currentPerson();
    if (!user) return { ok: false };
    const roomId = tripRoomId(tripId);
    const lb = liveblocks();
    const room = await lb.getRoom(roomId);
    if (!room.usersAccesses[user.id]) return { ok: false };
    const named = title.replace(/\s+/g, " ").trim().slice(0, MAX_TRIP_TITLE);
    const next = named || planTitle(await readPlan(tripId));
    await lb.updateRoom(roomId, { metadata: { title: next, titleSet: named ? "1" : null, updatedAt: new Date().toISOString() } });
    return { ok: true, title: next };
  } catch (e) {
    if (!isNotFound(e)) console.warn("renameTrip failed");
    return { ok: false };
  }
}
