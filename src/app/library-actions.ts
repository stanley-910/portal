"use server";

import { getAccountClaims } from "@/lib/supabase/server";
import type { LibraryTrip } from "@/lib/trip/library";
import { listMyLibrary } from "@/lib/trip/server";

/** The signed-in person's trips for the library sidebar, with their id; null for a guest. */
export async function loadLibrary(): Promise<{ userId: string; trips: LibraryTrip[] } | null> {
  const account = await getAccountClaims();
  if (!account) return null;
  return { userId: account.id, trips: await listMyLibrary(account.id) };
}
