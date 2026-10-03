import { ensurePerson } from "@/lib/identity";
import { joinTrip, liveblocks } from "@/lib/liveblocks/server";
import { adoptGuest } from "@/lib/trip/adopt";
import { TRIP_ID } from "@/lib/liveblocks/types";

export const runtime = "nodejs";

/**
 * Issues a Liveblocks access token that lets the current person (account or guest) into this one trip room, with
 * their name and member colour. Holding the trip's URL is the invite, so this route decides access itself; the
 * room's access list only records who has joined. An ID token would make Liveblocks check that list on connect, and
 * in production it kept refusing people added while the room was already active.
 */
export async function POST(request: Request) {
  const { room } = (await request.json().catch(() => ({}))) as { room?: unknown };
  if (typeof room !== "string" || !room.startsWith("trip:") || !TRIP_ID.test(room.slice(5))) {
    return Response.json({ error: "Unknown room" }, { status: 403 });
  }

  const person = await ensurePerson();
  // someone who joined trips as a guest and has signed in since: their guest self becomes this account
  if (person.account) await adoptGuest(person.id);
  const color = await joinTrip(room, person.id);
  if (color === null) return Response.json({ error: "Trip not found" }, { status: 404 });

  const session = liveblocks().prepareSession(person.id, { userInfo: { name: person.name ?? "Guest", color } });
  session.allow(room, session.FULL_ACCESS);
  const { status, body } = await session.authorize();
  return new Response(body, { status });
}
