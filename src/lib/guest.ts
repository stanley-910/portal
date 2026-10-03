import "server-only";

import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";

import { parseNationalities } from "./nationality";

// Who you are before signing in: a random id in a cookie. Clearing cookies makes you a new person.
const ID_COOKIE = "portal_guest";
const NAME_COOKIE = "portal_name";
const PASSPORTS_COOKIE = "portal_passports";
const YEAR = 60 * 60 * 24 * 365;

export { MAX_NAME } from "./guest-name";

export interface Guest {
  id: string;
  name: string | null;
  /** ISO-3 passport countries. */
  nationalities: string[];
}

/** The current guest, if they have visited before. Safe in Server Components. */
export async function readGuest(): Promise<Guest | null> {
  const jar = await cookies();
  const id = jar.get(ID_COOKIE)?.value;
  return id
    ? { id, name: jar.get(NAME_COOKIE)?.value ?? null, nationalities: parseNationalities(jar.get(PASSPORTS_COOKIE)?.value) }
    : null;
}

const cookieOptions = () =>
  ({ httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: YEAR, path: "/" }) as const;

/** The current guest, creating one on first visit. Only in Server Functions and Route Handlers. */
export async function ensureGuest(): Promise<Guest> {
  const existing = await readGuest();
  if (existing) return existing;
  const id = `g_${randomUUID()}`;
  (await cookies()).set(ID_COOKIE, id, cookieOptions());
  return { id, name: null, nationalities: [] };
}

/** Saves the guest's passports. Only in Server Functions and Route Handlers. */
export async function setGuestNationalities(codes: string[]) {
  (await cookies()).set(PASSPORTS_COOKIE, parseNationalities(codes).join(","), cookieOptions());
}

/** Saves the guest's display name. Only in Server Functions and Route Handlers. */
export async function setGuestName(name: string) {
  (await cookies()).set(NAME_COOKIE, name, cookieOptions());
}
