"use server";

import { currentPerson } from "@/lib/identity";
import { isNotFound, liveblocks } from "@/lib/liveblocks/server";
import { TRIP_ID, tripRoomId, type TripEvent } from "@/lib/liveblocks/types";
import { afterLeave, applyLeave, leaveChanges, tripOwner, type LeaveInput } from "@/lib/trip/leave";

/**
 * The trip room, if the current person (account or guest) is in it. With `action`, says in the server log why not,
 * since the dialogs that call these only say it failed.
 */
async function myRoom(tripId: string, action?: string) {
  const refuse = (reason: string) => {
    if (action) console.warn(`[trip] ${action} ${tripId}: ${reason}`);
    return null;
  };
  const person = await currentPerson();
  if (!person) return refuse("no account session and no guest cookie");
  if (!TRIP_ID.test(tripId)) return refuse("not a trip id");
  const roomId = tripRoomId(tripId);
  const room = await liveblocks().getRoom(roomId).catch((error: unknown) => {
    if (isNotFound(error)) return null;
    throw error;
  });
  if (!room) return refuse("the trip is gone");
  if (!room.usersAccesses[person.id]) return refuse(`${person.id} is not a member`);
  return { person, roomId, room };
}

/** Deletes a trip room for everyone, telling anyone in it first so their screen can say the trip ended. */
async function removeTrip(roomId: string) {
  const lb = liveblocks();
  // without this, people in the room stay "connected" to a room that no longer exists
  await lb.broadcastEvent(roomId, { type: "trip-ended" } satisfies TripEvent).catch((error: unknown) => {
    console.warn(`[trip] telling ${roomId} it ended failed:`, error);
  });
  await lb.deleteRoom(roomId);
}

/**
 * Ends a trip for everyone, from inside it or from the library: the plan, the thread and the room are deleted. Only
 * the owner can, account or guest, since a trip can pass on to a guest.
 */
export async function endTrip(tripId: string): Promise<{ ok: boolean }> {
  try {
    const mine = await myRoom(tripId, "ending");
    if (!mine) return { ok: false };
    if (tripOwner(mine.room.metadata) !== mine.person.id) {
      console.warn(`[trip] ending ${tripId}: ${mine.person.id} is not the owner`);
      return { ok: false };
    }
    await removeTrip(mine.roomId);
    return { ok: true };
  } catch (error) {
    console.error(`[trip] ending ${tripId} failed:`, error);
    return { ok: false };
  }
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
  try {
    const mine = await myRoom(tripId, "leaving");
    if (!mine) return { ok: false };
    const { person, roomId, room } = mine;
    const lb = liveblocks();
    const { members, owner } = afterLeave(room.metadata, person.id);

    if (members.length === 0) {
      await removeTrip(roomId);
    } else {
      const changes = leaveChanges((await lb.getStorageDocument(roomId, "json")) as LeaveInput, person.id);
      await lb.mutateStorage(roomId, ({ root }) => applyLeave(root, changes, person.id, owner));
      await lb.updateRoom(roomId, { usersAccesses: { [person.id]: null }, metadata: { members, owner } });
    }
    // no revalidatePath: it would re-render the trip page you're on, and only reconnecting may join you again
    return { ok: true };
  } catch (error) {
    // the dialog only says it failed, so the reason has to be in the server log
    console.error(`[trip] leaving ${tripId} failed:`, error);
    return { ok: false };
  }
}
