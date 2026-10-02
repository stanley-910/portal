"use server";

import { randomBytes } from "node:crypto";

import { redirect } from "next/navigation";

import { ensureGuest, MAX_NAME, setGuestName } from "@/lib/guest";
import { liveblocks } from "@/lib/liveblocks/server";
import { tripRoomId } from "@/lib/liveblocks/types";

/** Creates a trip room owned by the current guest and opens it. Its URL is the invite (M7). */
export async function createTrip() {
  const guest = await ensureGuest();
  const id = randomBytes(12).toString("base64url");
  await liveblocks().createRoom(tripRoomId(id), {
    defaultAccesses: [],
    usersAccesses: { [guest.id]: ["room:write"] },
    metadata: { members: [guest.id] },
  });
  redirect(`/t/${id}`);
}

/** Saves the name others see on your cursor and avatar. */
export async function saveName(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().slice(0, MAX_NAME);
  await ensureGuest();
  if (name) await setGuestName(name);
}
