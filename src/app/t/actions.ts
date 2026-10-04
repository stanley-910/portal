"use server";

import { randomBytes } from "node:crypto";

import { redirect } from "next/navigation";

import { ensureGuest, MAX_NAME, setGuestName } from "@/lib/guest";
import { currentPerson } from "@/lib/identity";
import { liveblocks } from "@/lib/liveblocks/server";
import { TRIP_ID, tripRoomId } from "@/lib/liveblocks/types";
import { getCurrentUser } from "@/lib/supabase/server";
import { editPlan, undoChangeset, type EditOp } from "@/lib/agent/edit";
import { handlesFor, type PlanJson } from "@/lib/agent/snapshot";
import { meetupOps } from "@/lib/agent/tools";
import { planIssues } from "@/lib/agent/issues";
import { AGENT_ID, type ThreadMessage } from "@/lib/agent/types";
import { LiveObject } from "@liveblocks/node";
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
    (card.type === "changes" || card.type === "meetup" || card.type === "fix") && card.changesetId === changesetId ? { ...card, undone: true } : card,
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

/** Pip's notes on the trip at most, so a plan with many problems doesn't flood the chat. */
const MAX_NOTES = 3;

/**
 * A member's client saw something wrong in the plan: Pip says so in the chat, once per problem, with its fixes. The
 * plan is checked here, not trusted from the client, and a problem already noted isn't noted again.
 */
export async function notePlanIssues(tripId: string) {
  const member = await memberRoom(tripId);
  if (!member) return;
  const lb = liveblocks();
  const issues = planIssues((await lb.getStorageDocument(member.roomId, "json")) as PlanJson);
  if (!issues.length) return;
  await lb.mutateStorage(member.roomId, ({ root }) => {
    const thread = root.get("thread");
    if (!thread) return;
    // checked against the thread as it is now, so two members' clients noticing at once say it once
    const said = new Set([...thread].flatMap((m) => m.get("cards").flatMap((c) => (c.type === "fix" ? [c.key] : []))));
    const fresh = issues.filter((i) => !said.has(i.key)).slice(0, MAX_NOTES);
    for (const issue of fresh) {
      const message: ThreadMessage = {
        id: randomBytes(6).toString("base64url"), at: Date.now(), author: { kind: "agent" }, text: issue.text, state: "done",
        cards: [{ type: "fix", key: issue.key, fixes: issue.fixes, state: "open", changesetId: null, undone: false }],
      };
      thread.push(new LiveObject(message) as never);
    }
  });
}

/**
 * A fix button on Pip's note: applied as one change people can undo, if the problem's still there. An "ask" fix
 * changes nothing here; its prompt goes back for the client to send to Pip in the clicker's name.
 */
export async function applyFix(tripId: string, messageId: string, index: number): Promise<{ ask?: string } | null> {
  const member = await memberRoom(tripId);
  if (!member) return null;
  const plan = (await liveblocks().getStorageDocument(member.roomId, "json")) as PlanJson;
  const card = plan.thread?.find((m) => m.id === messageId)?.cards.find((c): c is Extract<ThreadCard, { type: "fix" }> => c.type === "fix");
  const fix = card?.fixes[index];
  if (!card || !fix || card.state !== "open") return null;
  const mark = (state: "fixed" | "asked" | "gone", changesetId: string | null = null) =>
    markCard(member.roomId, messageId, (c) => (c.type === "fix" && c.key === card.key ? { ...c, state, changesetId } : c));
  // sorted out since Pip said it: nothing to do
  if (!planIssues(plan).some((i) => i.key === card.key)) return void (await mark("gone")), null;
  if (fix.kind === "ask") {
    await mark("asked");
    return { ask: fix.prompt };
  }
  const h = handlesFor(plan);
  const ops: EditOp[] = fix.kind === "merge"
    ? [
        { op: "set_riders", leg: h.leg.get(fix.keep)!, riders: [...new Set([...plan.legs![fix.keep].riders, ...plan.legs![fix.drop].riders])].map((id) => h.member.get(id)!) },
        { op: "remove_leg", leg: h.leg.get(fix.drop)! },
      ]
    : [{ op: "add_leg", from: { stop: h.stop.get(fix.from)! }, to: { stop: h.stop.get(fix.to)! }, date: fix.date, riders: [h.member.get(fix.member)!] }];
  const result = await editPlan(member.roomId, plan, h, ops, AGENT_ID, undefined, undefined, true);
  if (result.changesetId) await mark("fixed", result.changesetId);
  return null;
}
