"use server";

import { revalidatePath } from "next/cache";

import { currentPerson } from "@/lib/identity";
import { isNotFound, liveblocks } from "@/lib/liveblocks/server";
import { TRIP_ID, tripRoomId } from "@/lib/liveblocks/types";

/** Permanently removes a trip room the signed-in user belongs to. */
export async function deleteTrip(formData: FormData) {
  const person = await currentPerson();
  const tripId = String(formData.get("tripId") ?? "");
  if (!person?.account || !TRIP_ID.test(tripId)) return;

  const roomId = tripRoomId(tripId);
  const room = await liveblocks().getRoom(roomId).catch((error: unknown) => {
    if (isNotFound(error)) return null;
    throw error;
  });
  if (!room?.usersAccesses[person.id]) return;

  await liveblocks().deleteRoom(roomId);
  revalidatePath("/trips");
}
