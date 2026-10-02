import { ensureGuest } from "@/lib/guest";
import { joinTrip, liveblocks } from "@/lib/liveblocks/server";
import { TRIP_ID } from "@/lib/liveblocks/types";

export const runtime = "nodejs";

/**
 * Issues a Liveblocks ID token for the guest (M4), with their name and member colour. The trip page has normally
 * added them to the room already; joining again here is a no-op that covers a page cached from before they joined.
 */
export async function POST(request: Request) {
  const { room } = (await request.json().catch(() => ({}))) as { room?: unknown };
  if (typeof room !== "string" || !room.startsWith("trip:") || !TRIP_ID.test(room.slice(5))) {
    return Response.json({ error: "Unknown room" }, { status: 403 });
  }

  const guest = await ensureGuest();
  const color = await joinTrip(room, guest.id);
  if (color === null) return Response.json({ error: "Trip not found" }, { status: 404 });

  const { status, body } = await liveblocks().identifyUser(
    { userId: guest.id, groupIds: [] },
    { userInfo: { name: guest.name ?? "Guest", color } },
  );
  return new Response(body, { status });
}
