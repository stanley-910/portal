import { after } from "next/server";
import { z } from "zod";

import { postToPip, runAgent } from "@/lib/agent/run";
import { liveblocks } from "@/lib/liveblocks/server";
import { TRIP_ID, tripRoomId } from "@/lib/liveblocks/types";
import { currentPerson } from "@/lib/identity";
import { CURRENCIES, type Currency } from "@/lib/currency";

// Posts a message to a trip's thread. Every message is to Pip, so every one wakes it. The reply arrives through the
// room, not this response: everyone in the trip sees it at once.

export const runtime = "nodejs";
// a run is capped at 90 s (lib/agent/run.ts); this leaves room to write the reply
export const maxDuration = 120;

const MAX_TEXT = 2_000;

// Per person: at most this many messages in a minute. Kept in memory, so it's per server instance and
// resets on deploy: enough to stop one person hammering the model, not a quota. The daily cap per trip is in run.ts.
const WAKES_PER_MINUTE = 6;
const recent = new Map<string, number[]>();
function allowWake(personId: string, now = Date.now()) {
  const times = (recent.get(personId) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= WAKES_PER_MINUTE) return false;
  recent.set(personId, [...times, now]);
  if (recent.size > 5_000) recent.delete(recent.keys().next().value!);
  return true;
}
const Body = z.object({
  tripId: z.string().regex(TRIP_ID),
  text: z.string().trim().min(1).max(MAX_TEXT),
  currency: z.enum(CURRENCIES).default("USD"),
});

export async function POST(request: Request) {
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ code: "BAD_REQUEST" }, { status: 400 });

  const user = await currentPerson();
  const roomId = tripRoomId(body.data.tripId);
  const room = await liveblocks().getRoom(roomId).catch(() => null);
  // posting can spend model and provider quota, so only members can
  if (!user || !room?.usersAccesses[user.id]) return Response.json({ code: "FORBIDDEN" }, { status: 403 });

  // talking to Pip needs an account; checked before posting, so a guest's message isn't left unanswered
  if (!user.account) return Response.json({ code: "SIGN_IN" }, { status: 401 });
  if (!allowWake(user.id)) return Response.json({ code: "RATE_LIMITED" }, { status: 429, headers: { "retry-after": "60" } });
  const { messageId, claim } = await postToPip(roomId, user.id, body.data.text, {
    nationalities: user.nationalities,
    currency: body.data.currency as Currency,
  });
  if (claim) after(() => runAgent(roomId, claim, user.id));
  return Response.json({ messageId, agent: !!claim });
}
