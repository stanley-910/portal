import "server-only";

import { ensureGuest, readGuest } from "@/lib/guest";
import { getCurrentUser } from "@/lib/supabase/server";

/**
 * Who is using the app: a signed-in account, or else a guest cookie. Guests can use the globe and join a trip from its
 * link; saving a trip and asking Pip need an account. Supabase being off or down leaves everyone a guest, so trips
 * keep working.
 */
export type Person = { id: string; name: string | null; email: string | null; account: boolean; nationalities: string[] };

/** The current person without creating a guest. Safe in Server Components. */
export async function currentPerson(): Promise<Person | null> {
  const user = await getCurrentUser();
  if (user) return { id: user.id, name: user.displayName, email: user.email, account: true, nationalities: user.nationalities };
  const guest = await readGuest();
  return guest ? { id: guest.id, name: guest.name, email: null, account: false, nationalities: guest.nationalities } : null;
}

/** The current person, creating a guest on first visit. Only in Server Functions and Route Handlers. */
export async function ensurePerson(): Promise<Person> {
  const person = await currentPerson();
  if (person) return person;
  const guest = await ensureGuest();
  return { id: guest.id, name: guest.name, email: null, account: false, nationalities: guest.nationalities };
}
