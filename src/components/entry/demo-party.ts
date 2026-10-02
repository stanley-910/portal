import type { EntryMember } from "@/lib/entry";

/** Mock party for the demo route until members come from the trip (Supabase / Liveblocks tickets). */
export const DEMO_PARTY: EntryMember[] = [
  { id: "mei", name: "Mei", passport: "HKG" },
  { id: "ada", name: "Ada", passport: "GBR" },
  { id: "joon", name: "Joon", passport: "KOR" },
  { id: "sam", name: "Sam", passport: "USA" },
];
