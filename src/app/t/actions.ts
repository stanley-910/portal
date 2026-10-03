"use server";

import { randomBytes } from "node:crypto";

import { LiveMap, LiveObject } from "@liveblocks/node";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { ensureGuest, MAX_NAME, setGuestName } from "@/lib/guest";
import { currentPerson } from "@/lib/identity";
import { liveblocks } from "@/lib/liveblocks/server";
import { TRIP_ID, tripRoomId } from "@/lib/liveblocks/types";
import { getCurrentUser } from "@/lib/supabase/server";
import { editPlan, undoChangeset } from "@/lib/agent/edit";
import { postToPip, runAgent } from "@/lib/agent/run";
import { handlesFor, type PlanJson } from "@/lib/agent/snapshot";
import { meetupOps } from "@/lib/agent/tools";
import type { ThreadCard } from "@/lib/agent/types";
import { runLegSearch } from "@/lib/trip/search-leg";

/** Creates a trip room owned by the signed-in user and opens it. Its URL is the invite. Saving a trip needs an
 * account; friends who open the link can join as guests. */
export async function createTrip() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/");
  const id = randomBytes(12).toString("base64url");
  await liveblocks().createRoom(tripRoomId(id), {
    defaultAccesses: [],
    usersAccesses: { [user.id]: ["room:write"] },
    metadata: { members: [user.id], title: "New trip", updatedAt: new Date().toISOString() },
  });
  redirect(`/t/${id}`);
}

const MAX_TEXT = 2_000;

/**
 * Starts a solo trip from the home globe with a first message to Pip, so you can plan before there's a trip
 * (harness: solo planners). Friends join later from the trip's URL as usual. Pip needs an account.
 */
export async function startTripWithPip(text: string) {
  const message = text.trim().slice(0, MAX_TEXT);
  if (!message) return;
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/");
  const id = randomBytes(12).toString("base64url");
  const roomId = tripRoomId(id);
  await liveblocks().createRoom(roomId, {
    defaultAccesses: [],
    usersAccesses: { [user.id]: ["room:write"] },
    metadata: { members: [user.id], title: "New trip", updatedAt: new Date().toISOString() },
  });
  await liveblocks().mutateStorage(roomId, ({ root }) => {
    // a new room's Storage is empty until a client loads it; lay out the trip so the server can write to it
    if (!root.get("members")) root.set("members", new LiveMap([[user.id, new LiveObject({ name: user.displayName, color: 1 })]]));
    if (!root.get("stops")) root.set("stops", new LiveMap());
    if (!root.get("legs")) root.set("legs", new LiveMap());
  });
  const { claim } = await postToPip(roomId, user.id, message);
  if (claim) after(() => runAgent(roomId, claim, user.id));
  redirect(`/t/${id}?pip=open`);
}

/** Saves the name a guest's friends see on their cursor and avatar. Accounts rename through their profile. */
export async function saveName(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().slice(0, MAX_NAME);
  await ensureGuest();
  if (name) await setGuestName(name);
}

/** Starts the route search for one leg on the server, so provider keys stay there and results land even if
 * whoever drew the leg closes the tab. */
export async function searchLeg(tripId: string, legId: string, searchId: string) {
  if (!TRIP_ID.test(tripId)) return;
  const roomId = tripRoomId(tripId);
  const user = await currentPerson();
  const room = await liveblocks().getRoom(roomId).catch(() => null);
  // the search spends provider quota, so only members can start one
  if (!user || !room?.usersAccesses[user.id]) return;
  await runLegSearch(roomId, legId, searchId);
}

/** Members only: the agent's changes and meet-ups are plan edits like any other. */
async function memberRoom(tripId: string) {
  if (!TRIP_ID.test(tripId)) return null;
  const roomId = tripRoomId(tripId);
  const user = await currentPerson();
  const room = await liveblocks().getRoom(roomId).catch(() => null);
  return user && room?.usersAccesses[user.id] ? { roomId, user } : null;
}

/** Undo on a card: puts back what one of Pip's changes did, and marks the card undone. */
export async function undoAgentChange(tripId: string, messageId: string, changesetId: string) {
  const member = await memberRoom(tripId);
  if (!member) return;
  await undoChangeset(member.roomId, changesetId);
  await markCard(member.roomId, messageId, (card) =>
    (card.type === "changes" || card.type === "meetup") && card.changesetId === changesetId ? { ...card, undone: true } : card,
  );
}

/** Apply on a meet-up card: adds one leg per group to the meeting city, without going through the model. */
export async function applyMeetup(tripId: string, messageId: string, optionId: string) {
  const member = await memberRoom(tripId);
  if (!member) return;
  const lb = liveblocks();
  const plan = (await lb.getStorageDocument(member.roomId, "json")) as PlanJson;
  const card = plan.thread
    ?.find((m) => m.id === messageId)
    ?.cards.find((c): c is Extract<ThreadCard, { type: "meetup" }> => c.type === "meetup" && c.options.some((o) => o.id === optionId));
  const option = card?.options.find((o) => o.id === optionId);
  if (!card || !option || (card.applied && !card.undone)) return;
  const handles = handlesFor(plan);
  const result = await editPlan(member.roomId, plan, handles, meetupOps(option, handles), member.user.id);
  await markCard(member.roomId, messageId, (c) =>
    c === undefined || c.type !== "meetup" || !c.options.some((o) => o.id === optionId)
      ? c
      : { ...c, applied: optionId, changesetId: result.changesetId, undone: false },
  );
}

async function markCard(roomId: string, messageId: string, update: (card: ThreadCard) => ThreadCard) {
  await liveblocks().mutateStorage(roomId, ({ root }) => {
    const message = root.get("thread")?.find((m) => m.get("id") === messageId);
    if (message) message.set("cards", message.get("cards").map(update));
  });
}
