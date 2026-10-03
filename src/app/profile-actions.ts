"use server";

import { ensureGuest, setGuestColor, setGuestNationalities } from "@/lib/guest";
import { asMemberColor } from "@/lib/liveblocks/types";
import { parseNationalities } from "@/lib/nationality";
import { createSupabaseServer, getCurrentUser } from "@/lib/supabase/server";

/** Saves the passports you hold: on your account when signed in, else on your guest cookie. */
export async function saveNationalities(codes: string[]) {
  const nationalities = parseNationalities(codes);
  if (await getCurrentUser()) {
    const supabase = await createSupabaseServer();
    await supabase?.auth.updateUser({ data: { nationalities } });
    // a fresh token carries the new passports, so Pip on the home globe (which reads the token) sees them now
    await supabase?.auth.refreshSession().catch(() => {});
    return;
  }
  await ensureGuest();
  await setGuestNationalities(nationalities);
}

/**
 * Saves the member colour you picked (1 to MEMBER_COLORS): on your account when signed in, else on your guest cookie.
 * Trips you join use it from then on instead of one handed out in join order; the room you're in records it itself.
 */
export async function saveColor(value: number) {
  const color = asMemberColor(value);
  if (color === null) return;
  if (await getCurrentUser()) {
    const supabase = await createSupabaseServer();
    const { error } = (await supabase?.auth.updateUser({ data: { color } })) ?? {};
    if (error) console.warn("[profile] saving the colour failed:", error.message);
    return;
  }
  await ensureGuest();
  await setGuestColor(color);
}
