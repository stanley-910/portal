import { ensureGuest } from "@/lib/guest";
import { joinTrip, liveblocks } from "@/lib/liveblocks/server";
import { TRIP_ID } from "@/lib/liveblocks/types";

export const runtime = "nodejs";

/**
 * Issues a Liveblocks access token for the guest (M4) that lets them into this one trip room, with their name and
 * member colour. Holding the trip's URL is the invite (M7), so this route decides access itself; the room's access
 * list only records who has joined. An ID token would make Liveblocks check that list on connect, and in production
 * it kept refusing guests added while the room was already active.
 */
export async function POST(request: Request) {
  const { room } = (await request.json().catch(() => ({}))) as { room?: unknown };
  if (typeof room !== "string" || !room.startsWith("trip:") || !TRIP_ID.test(room.slice(5))) {
    return Response.json({ error: "Unknown room" }, { status: 403 });
  }

  const guest = await ensureGuest();
  const color = await joinTrip(room, guest.id);
  if (color === null) return Response.json({ error: "Trip not found" }, { status: 404 });

  const session = liveblocks().prepareSession(guest.id, { userInfo: { name: guest.name ?? "Guest", color } });
  session.allow(room, session.FULL_ACCESS);
  const { status, body } = await session.authorize();
  return new Response(body, { status });
}
