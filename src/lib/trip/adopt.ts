import "server-only";

import { LiveObject } from "@liveblocks/node";

import { forgetGuest, readGuest } from "@/lib/guest";
import { liveblocks } from "@/lib/liveblocks/server";

// Someone who opens a trip link signed out joins as a guest; signing in later makes them an account, which is a
// different id. Without this, the guest stayed behind as a second member: an extra rider chip on every leg, a name
// in Pip's header, and a share in the head count.

type Root = LiveObject<Liveblocks["Storage"]>;

/** Moves everything one guest did in a trip's Storage onto their account. Runs inside mutateStorage. */
export function adoptInStorage(root: Root, guestId: string, accountId: string) {
  const swap = (id: string) => (id === guestId ? accountId : id);

  const members = root.get("members");
  const guest = members.get(guestId);
  if (guest) {
    const account = members.get(accountId);
    // the account keeps its own name; a leave date set while they were a guest still counts
    if (!account) members.set(accountId, new LiveObject({ ...guest.toJSON() }));
    else if (account.get("leaves") === undefined && guest.get("leaves") !== undefined) account.set("leaves", guest.get("leaves"));
    members.delete(guestId);
  }

  for (const leg of root.get("legs").values()) {
    const riders = leg.get("riders");
    if (riders.includes(guestId)) leg.set("riders", [...new Set(riders.map(swap))]);
    if (leg.get("createdBy") === guestId) leg.set("createdBy", accountId);
    const votes = leg.get("votes");
    const vote = votes.get(guestId);
    if (vote !== undefined) {
      if (!votes.has(accountId)) votes.set(accountId, vote);
      votes.delete(guestId);
    }
  }

  for (const message of root.get("thread") ?? []) {
    const author = message.get("author");
    if (author.kind === "member" && author.id === guestId) message.set("author", { kind: "member", id: accountId });
  }

  // Undo snapshots name riders too; guest ids are unique enough to swap in the JSON
  const changesets = root.get("changesets");
  for (const [id, json] of changesets ?? []) {
    if (json.includes(guestId)) changesets!.set(id, json.replaceAll(`"${guestId}"`, `"${accountId}"`));
  }
}

/**
 * Hands every trip a guest joined to an account: room access, member list, riders, votes, legs they drew and their
 * messages. False if Liveblocks failed partway; running it again finishes the job.
 */
export async function adoptTrips(guestId: string, accountId: string): Promise<boolean> {
  const lb = liveblocks();
  try {
    for await (const room of lb.iterRooms({ userId: guestId })) {
      if (!room.id.startsWith("trip:")) continue;
      const raw = room.metadata.members;
      const members = Array.isArray(raw) ? raw : raw ? [raw] : [];
      // the account takes the guest's place in join order, so it keeps the guest's colour
      await lb.updateRoom(room.id, {
        usersAccesses: { [accountId]: ["room:write"], [guestId]: null },
        metadata: {
          members: [...new Set(members.map((m) => (m === guestId ? accountId : m)))],
          // a trip passed on to the guest (trips/leave.ts) stays theirs
          ...(room.metadata.owner === guestId ? { owner: accountId } : {}),
        },
      });
      await lb.mutateStorage(room.id, ({ root }) => {
        if (root.get("members")) adoptInStorage(root, guestId, accountId);
      });
    }
    return true;
  } catch (error) {
    console.warn("[trip] adopting guest failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Gives the guest cookie's trips to the account just signed in, then drops the cookie so it only happens once. If
 * Liveblocks fails, the cookie stays and the next sign-in or trip visit tries again. Only in Server Functions and
 * Route Handlers.
 */
export async function adoptGuest(accountId: string) {
  const guest = await readGuest();
  if (!guest || guest.id === accountId) return;
  if (await adoptTrips(guest.id, accountId)) await forgetGuest();
}
