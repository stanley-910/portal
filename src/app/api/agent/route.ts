import { after } from "next/server";
import { z } from "zod";

import { postMessage, runAgent } from "@/lib/agent/run";
import { wakesAgent } from "@/lib/agent/types";
import { liveblocks } from "@/lib/liveblocks/server";
import { TRIP_ID, tripRoomId } from "@/lib/liveblocks/types";
import { getCurrentUser } from "@/lib/supabase/server";

// Posts a message to a trip's thread, and wakes Pip when it's mentioned (M15). The reply arrives through the room,
// not this response: everyone in the trip sees it at once.

export const runtime = "nodejs";
// a run is capped at 90 s (lib/agent/run.ts); this leaves room to write the reply
export const maxDuration = 120;

const MAX_TEXT = 2_000;
const Body = z.object({ tripId: z.string().regex(TRIP_ID), text: z.string().trim().min(1).max(MAX_TEXT) });

export async function POST(request: Request) {
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ code: "BAD_REQUEST" }, { status: 400 });

  const user = await getCurrentUser();
  const roomId = tripRoomId(body.data.tripId);
  const room = await liveblocks().getRoom(roomId).catch(() => null);
  // posting can spend model and provider quota, so only members can
  if (!user || !room?.usersAccesses[user.id]) return Response.json({ code: "FORBIDDEN" }, { status: 403 });

  const messageId = await postMessage(roomId, user.id, body.data.text);
  const members = Array.isArray(room.metadata.members) ? room.metadata.members.length : 1;
  const wake = wakesAgent(body.data.text, members);
  if (wake) after(() => runAgent(roomId, messageId, user.id));
  return Response.json({ messageId, agent: wake });
}
