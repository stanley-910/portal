"use server";

import { randomBytes } from "node:crypto";

import { redirect } from "next/navigation";

import { liveblocks } from "@/lib/liveblocks/server";
import { tripRoomId } from "@/lib/liveblocks/types";
import { getAccountClaims, profileName } from "@/lib/supabase/server";
import { buildSoloStorage, soloSaveSchema, toStorageLson } from "@/lib/trip/server";
import { planTitle } from "@/lib/trip/title";

/** `legs` are the new legs' ids, in the order they were sent. */
export type SaveSoloTripResult = { id: string; legs: string[] } | { error: "invalid" | "failed" };

const shortId = () => randomBytes(6).toString("base64url");

/**
 * Saves the legs landed on `/`, each with its picked option chosen, as a new trip in the person's account, and
 * returns its id. It doesn't open it: the globe stays as it is, and the trip is in their trips to open or share.
 * Without an account, goes to sign in. Invalid input or a Liveblocks failure returns an error instead, and leaves no
 * room behind.
 *
 * It's two Liveblocks calls in a row (create the room, then fill its Storage), so nothing else waits in front of them:
 * the account comes from the session's verified claims, with no Supabase round trip, and the profile name is looked
 * up while the room is being created.
 */
export async function saveSoloTrip(input: unknown): Promise<SaveSoloTripResult> {
  const account = await getAccountClaims();
  if (!account) redirect("/login?next=/");
  const parsed = soloSaveSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };

  const now = Date.now();
  const name = profileName(account.id);
  const storage = buildSoloStorage(parsed.data, { id: account.id, displayName: account.name }, shortId, now);
  const id = randomBytes(12).toString("base64url");
  const roomId = tripRoomId(id);
  const lb = liveblocks();
  let created = false;
  try {
    // the same access shape as createTrip: private, the saver is the only member
    await lb.createRoom(roomId, {
      defaultAccesses: [],
      usersAccesses: { [account.id]: ["room:write"] },
      metadata: { members: [account.id], title: planTitle(storage), updatedAt: new Date(now).toISOString() },
    });
    created = true;
    // the profile's name, when it has one, is the one the trip shows, as everywhere else
    const profile = await name;
    if (profile) storage.members[account.id].name = profile;
    // a brand-new room has empty Storage and nobody connected, which initializeStorageDocument requires
    await lb.initializeStorageDocument(roomId, toStorageLson(storage));
  } catch {
    console.warn("saveSoloTrip failed");
    if (created) await lb.deleteRoom(roomId).catch(() => {});
    return { error: "failed" };
  }
  // createdAt keeps the order they were sent in
  return { id, legs: Object.entries(storage.legs).sort((a, b) => a[1].createdAt - b[1].createdAt).map(([legId]) => legId) };
}
