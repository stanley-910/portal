import "server-only";

import type { RoomData } from "@liveblocks/node";

import { liveblocks } from "@/lib/liveblocks/server";
import { tripRoomId } from "@/lib/liveblocks/types";

export type TripSummary = { id: string; title: string; members: number; updatedAt: string };

/** The saved plan of a trip room as plain JSON. Unreadable Storage reads as an empty plan. */
export async function readPlan(tripId: string): Promise<unknown> {
  try {
    return await liveblocks().getStorageDocument(tripRoomId(tripId), "json");
  } catch {
    return {};
  }
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []);
const asString = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Room list rows, newest activity first. `members` metadata may be a string or an array. */
export function toTripSummaries(rooms: Pick<RoomData, "id" | "metadata" | "createdAt" | "lastConnectionAt">[]): TripSummary[] {
  return rooms
    .map((room) => ({
      id: room.id.replace(/^trip:/, ""),
      title: asString(room.metadata.title) ?? "New trip",
      members: asList(room.metadata.members).length,
      updatedAt: asString(room.metadata.updatedAt) ?? (room.lastConnectionAt ?? room.createdAt).toISOString(),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The trips this user belongs to. Liveblocks being down gives an empty list, never an error. */
export async function listMyTrips(userId: string): Promise<TripSummary[]> {
  try {
    const { data } = await liveblocks().getRooms({ userId });
    return toTripSummaries(data.filter((room) => room.id.startsWith("trip:")));
  } catch {
    return [];
  }
}
