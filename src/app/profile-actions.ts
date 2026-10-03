"use server";

import { ensureGuest, setGuestNationalities } from "@/lib/guest";
import { parseNationalities } from "@/lib/nationality";
import { createSupabaseServer, getCurrentUser } from "@/lib/supabase/server";

/** Saves the passports you hold: on your account when signed in, else on your guest cookie. */
export async function saveNationalities(codes: string[]) {
  const nationalities = parseNationalities(codes);
  if (await getCurrentUser()) {
    const supabase = await createSupabaseServer();
    await supabase?.auth.updateUser({ data: { nationalities } });
    return;
  }
  await ensureGuest();
  await setGuestNationalities(nationalities);
}
