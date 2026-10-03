"use server";

import { revalidatePath } from "next/cache";

import { currentPerson } from "@/lib/identity";
import { isNotFound, liveblocks } from "@/lib/liveblocks/server";
import { TRIP_ID, tripRoomId } from "@/lib/liveblocks/types";
import { afterLeave, leaveChanges, tripOwner, type LeaveInput } from "@/lib/trip/leave";

/** The trip room, if the current person (account or guest) is in it. */
async function myRoom(tripId: string) {
  const person = await currentPerson();
  if (!person || !TRIP_ID.test(tripId)) return null;
  const roomId = tripRoomId(tripId);
  const room = await liveblocks().getRoom(roomId).catch((error: unknown) => {
    if (isNotFound(error)) return null;
    throw error;
  });
  return room?.usersAccesses[person.id] ? { person, roomId, room } : null;
}

/** Permanently removes a trip room. Only its owner can. */
export async function deleteTrip(formData: FormData) {
  const mine = await myRoom(String(formData.get("tripId") ?? ""));
  if (!mine?.person.account || tripOwner(mine.room.metadata) !== mine.person.id) return;

  await liveblocks().deleteRoom(mine.roomId);
  revalidatePath("/trips");
}

export type LeavePreview = { owner: boolean; nextOwner: string | null; last: boolean };

/** What leaving would do, for the confirm dialog: whether the trip passes to someone, or is deleted. */
export async function leavePreview(tripId: string): Promise<LeavePreview | null> {
  const mine = await myRoom(tripId);
  if (!mine) return null;
  const { members, owner } = afterLeave(mine.room.metadata, mine.person.id);
  const isOwner = tripOwner(mine.room.metadata) === mine.person.id;
  let nextOwner: string | null = null;
  if (isOwner && owner) {
    const plan = (await liveblocks().getStorageDocument(mine.roomId, "json").catch(() => ({}))) as { members?: Record<string, { name?: string }> };
    nextOwner = plan.members?.[owner]?.name ?? "the next person who joined";
  }
  return { owner: isOwner, nextOwner, last: members.length === 0 };
}

/**
 * Takes the current person out of a trip with everything they added: the legs they drew, their seats on others'
 * legs, their votes and their messages. The owner leaving passes the trip to whoever joined next; the last person
 * leaving deletes it. Opening the link again joins afresh, since the link is the invite.
 */
export async function leaveTrip(tripId: string): Promise<{ ok: boolean }> {
  const mine = await myRoom(tripId);
  if (!mine) return { ok: false };
  const { person, roomId, room } = mine;
  const lb = liveblocks();
  const { members, owner } = afterLeave(room.metadata, person.id);

  if (members.length === 0) {
    await lb.deleteRoom(roomId);
  } else {
    const changes = leaveChanges((await lb.getStorageDocument(roomId, "json")) as LeaveInput, person.id);
    await lb.mutateStorage(roomId, ({ root }) => {
      const legs = root.get("legs");
      const stops = root.get("stops");
      const stays = root.get("stays");
      for (const id of changes.legs) legs?.delete(id);
      for (const [id, riders] of Object.entries(changes.riders)) legs?.get(id)?.set("riders", riders);
      for (const id of changes.votes) legs?.get(id)?.get("votes").delete(person.id);
      for (const id of changes.stops) {
        stops?.delete(id);
        stays?.delete(id);
      }
      const thread = root.get("thread");
      if (thread) {
        for (let i = thread.length - 1; i >= 0; i--) if (changes.messages.includes(thread.get(i)!.get("id"))) thread.delete(i);
      }
      root.get("members")?.delete(person.id);
    });
    await lb.updateRoom(roomId, { usersAccesses: { [person.id]: null }, metadata: { members, owner } });
  }
  // no revalidatePath: in a Server Function it re-renders the page you're on, and the trip page joins you again
  return { ok: true };
}
