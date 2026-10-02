import { ensureGuest } from "@/lib/guest";
import { MEMBER_COLORS, TRIP_ID } from "@/lib/liveblocks/types";
import { isNotFound, liveblocks } from "@/lib/liveblocks/server";

export const runtime = "nodejs";

/**
 * Issues a Liveblocks ID token for the guest (M4). Opening a trip's URL is the invite (M7): the first time a
 * guest connects to a room, they are added to it with write access and given the next member colour.
 */
export async function POST(request: Request) {
  const { room } = (await request.json().catch(() => ({}))) as { room?: unknown };
  if (typeof room !== "string" || !room.startsWith("trip:") || !TRIP_ID.test(room.slice(5))) {
    return Response.json({ error: "Unknown room" }, { status: 403 });
  }

  const guest = await ensureGuest();
  const lb = liveblocks();

  let data;
  try {
    data = await lb.getRoom(room);
  } catch (e) {
    if (isNotFound(e)) return Response.json({ error: "Trip not found" }, { status: 404 });
    throw e;
  }

  // Join order sets colours. Two guests joining in the same instant can both get the same colour; fine for now.
  const metadataMembers = data.metadata.members;
  const members = Array.isArray(metadataMembers) ? metadataMembers : metadataMembers ? [metadataMembers] : [];
  if (!data.usersAccesses[guest.id]) {
    await lb.updateRoom(room, {
      usersAccesses: { [guest.id]: ["room:write"] },
      metadata: { members: members.includes(guest.id) ? members : [...members, guest.id] },
    });
  }
  const index = members.indexOf(guest.id);
  const color = ((index < 0 ? members.length : index) % MEMBER_COLORS) + 1;

  const { status, body } = await lb.identifyUser(
    { userId: guest.id, groupIds: [] },
    { userInfo: { name: guest.name ?? "Guest", color } },
  );
  return new Response(body, { status });
}
