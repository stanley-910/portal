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
    const title = planTitle(await readPlan(tripId));
    await lb.updateRoom(roomId, { metadata: { title, updatedAt: new Date().toISOString() } });
  } catch (e) {
    if (!isNotFound(e)) console.warn("refreshTripTitle failed");
  }
}
