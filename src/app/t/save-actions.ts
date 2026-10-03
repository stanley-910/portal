"use server";

import { randomBytes } from "node:crypto";

import { redirect } from "next/navigation";

import { liveblocks } from "@/lib/liveblocks/server";
import { tripRoomId } from "@/lib/liveblocks/types";
import { getCurrentUser } from "@/lib/supabase/server";
import { buildSoloStorage, soloSaveSchema, toStorageLson } from "@/lib/trip/server";
import { planTitle } from "@/lib/trip/title";

export type SaveSoloTripResult = { id: string } | { error: "invalid" | "failed" };

const shortId = () => randomBytes(6).toString("base64url");

/**
 * Saves the legs landed on `/`, each with its picked option chosen, as a new trip in the person's account, and
 * returns its id. It doesn't open it: the globe stays as it is, and the trip is in their trips to open or share.
 * Without an account, goes to sign in. Invalid input or a Liveblocks failure returns an error instead, and leaves no
 * room behind.
 */
export async function saveSoloTrip(input: unknown): Promise<SaveSoloTripResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/");
  const parsed = soloSaveSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };

  const now = Date.now();
  const storage = buildSoloStorage(parsed.data, user, shortId, now);
  const id = randomBytes(12).toString("base64url");
  const roomId = tripRoomId(id);
  const lb = liveblocks();
  let created = false;
  try {
    // the same access shape as createTrip: private, the saver is the only member
    await lb.createRoom(roomId, {
      defaultAccesses: [],
      usersAccesses: { [user.id]: ["room:write"] },
      metadata: { members: [user.id], title: planTitle(storage), updatedAt: new Date(now).toISOString() },
    });
    created = true;
    // a brand-new room has empty Storage and nobody connected, which initializeStorageDocument requires
    await lb.initializeStorageDocument(roomId, toStorageLson(storage));
  } catch {
    console.warn("saveSoloTrip failed");
    if (created) await lb.deleteRoom(roomId).catch(() => {});
    return { error: "failed" };
  }
  return { id };
}
