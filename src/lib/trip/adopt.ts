import "server-only";

import { LiveObject } from "@liveblocks/node";

import { meetupTotal } from "@/lib/agent/meetup";
import type { PlanJson } from "@/lib/agent/snapshot";
import { forgetGuest, readGuest } from "@/lib/guest";
import { liveblocks } from "@/lib/liveblocks/server";

// Someone who opens a trip link signed out joins as a guest; signing in later makes them an account, which is a
// different id. Without this, the guest stayed behind as a second member: an extra rider chip on every leg, a name
// in Pip's header, and a share in the head count.

type Root = LiveObject<Liveblocks["Storage"]>;

/** A list of member ids with the guest swapped for the account, each once. */
const swapIn = (ids: readonly string[], guestId: string, accountId: string) =>
  [...new Set(ids.map((id) => (id === guestId ? accountId : id)))];

/** A record keyed by member id with the guest's entry moved to the account, unless the account has its own. */
function moveKey<T>(record: Record<string, T> | undefined, guestId: string, accountId: string) {
  if (!record || !(guestId in record)) return record;
  const { [guestId]: guest, ...rest } = record;
  return accountId in rest ? rest : { ...rest, [accountId]: guest };
}

/**
 * An Undo snapshot (lib/agent/edit.ts) with the guest moved onto the account, by field: riders swapped and kept once,
 * the guest's vote and leave date moved unless the account has its own, legs they drew credited to the account.
 */
export function adoptChangeset(json: string, guestId: string, accountId: string): string {
  if (!json.includes(guestId)) return json;
  type LegBefore = { riders?: string[]; createdBy?: string; votes?: Record<string, string> } | null;
  const before = JSON.parse(json) as { legs?: Record<string, LegBefore>; leaves?: Record<string, unknown> };
  for (const leg of Object.values(before.legs ?? {})) {
    if (!leg) continue;
    if (leg.riders) leg.riders = swapIn(leg.riders, guestId, accountId);
    if (leg.createdBy === guestId) leg.createdBy = accountId;
    leg.votes = moveKey(leg.votes, guestId, accountId);
  }
  if (before.leaves) before.leaves = moveKey(before.leaves, guestId, accountId);
  return JSON.stringify(before);
}

/** Moves everything one guest did in a trip's Storage onto their account. Runs inside mutateStorage. */
export function adoptInStorage(root: Root, guestId: string, accountId: string) {
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
    if (riders.includes(guestId)) leg.set("riders", swapIn(riders, guestId, accountId));
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
    // a meet-up card's groups, so adding it later still puts them on the leg; both of them in one group is one person
    const cards = message.get("cards");
    if (!cards.some((c) => c.type === "meetup" && c.options.some((o) => o.legs.some((l) => l.members.includes(guestId))))) continue;
    message.set("cards", cards.map((c) => c.type !== "meetup" ? c : {
      ...c,
      options: c.options.map((o) => {
        if (!o.legs.some((l) => l.members.includes(guestId))) return o;
        const legs = o.legs.map((l) => {
          if (!l.members.includes(guestId)) return l;
          const members = swapIn(l.members, guestId, accountId);
          return { ...l, members, people: Math.max(1, l.people - (l.members.length - members.length)) };
        });
        // a head count that dropped changes what it costs everyone; the card keeps its order
        return { ...o, legs, total: meetupTotal(legs) };
      }),
    }));
  }

  const changesets = root.get("changesets");
  for (const [id, json] of changesets ?? []) {
    const next = adoptChangeset(json, guestId, accountId);
    if (next !== json) changesets!.set(id, next);
  }
}

/** Whether a trip's stored plan still has the guest in it, as a member or a rider. */
const guestIn = (plan: PlanJson, guestId: string) =>
  !!plan.members?.[guestId] || Object.values(plan.legs ?? {}).some((l) => l.riders.includes(guestId));

const membersOf = (raw: unknown) => (Array.isArray(raw) ? (raw as string[]) : typeof raw === "string" ? [raw] : []);

/**
 * Hands every trip a guest joined to an account: room access, member list, riders, votes, legs they drew and their
 * messages. False if Liveblocks failed partway; running it again finishes the job.
 */
export async function adoptTrips(guestId: string, accountId: string): Promise<boolean> {
  try {
    const lb = liveblocks();
    for await (const { id } of lb.iterRooms({ userId: guestId })) {
      if (!id.startsWith("trip:")) continue;
      // Storage first, then access: the guest keeps access until their things have moved, so a failure in between
      // leaves this room where the next try finds it. Moving the Storage again does nothing new.
      await lb.mutateStorage(id, ({ root }) => {
        if (root.get("members")) adoptInStorage(root, guestId, accountId);
      });
      // mutateStorage resolves even when its write fails (@liveblocks/node 3.24), so check it landed
      if (guestIn((await lb.getStorageDocument(id, "json")) as PlanJson, guestId)) throw new Error(`${id}: Storage didn't move`);
      // The member list is read just before it's written, and checked after: someone joining, leaving or signing in
      // at the same moment writes the whole list too, and Liveblocks keeps whichever lands last.
      for (let tries = 0; ; tries++) {
        const room = await lb.getRoom(id);
        const members = membersOf(room.metadata.members);
        if (!members.includes(guestId) && room.usersAccesses[guestId] === undefined) break;
        if (tries === 3) throw new Error(`${id}: members kept changing`);
        // the account takes the guest's place in join order, so it keeps the guest's colour
        await lb.updateRoom(id, {
          usersAccesses: { [accountId]: ["room:write"], [guestId]: null },
          metadata: {
            members: [...new Set(members.map((m) => (m === guestId ? accountId : m)))],
            // a trip passed on to the guest (trips/leave.ts) stays theirs
            ...(room.metadata.owner === guestId ? { owner: accountId } : {}),
          },
        });
      }
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
