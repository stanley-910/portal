import { joinTrip, liveblocks } from "@/lib/liveblocks/server";
import { TRIP_ID } from "@/lib/liveblocks/types";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Issues a Liveblocks access token for the signed-in user (M19) that lets them into this one trip room, with their
 * profile name and member colour. The Liveblocks user id is the Supabase user id. Holding the trip's URL is the
 * invite (M7), so this route decides access itself; the room's access list only records who has joined. An ID token
 * would make Liveblocks check that list on connect, and in production it kept refusing members added while the room
 * was already active.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in" }, { status: 401 });

  const { room } = (await request.json().catch(() => ({}))) as { room?: unknown };
  if (typeof room !== "string" || !room.startsWith("trip:") || !TRIP_ID.test(room.slice(5))) {
    return Response.json({ error: "Unknown room" }, { status: 403 });
  }

  const color = await joinTrip(room, user.id);
  if (color === null) return Response.json({ error: "Trip not found" }, { status: 404 });

  const session = liveblocks().prepareSession(user.id, { userInfo: { name: user.displayName, color } });
  session.allow(room, session.FULL_ACCESS);
  const { status, body } = await session.authorize();
  return new Response(body, { status });
}
