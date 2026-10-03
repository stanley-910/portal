import { displayPerson } from "@/lib/identity";

import { GlobeScreen } from "./globe-screen";

export default async function Home() {
  // Each call fails soft: `/` must render as a guest, or with Supabase or Liveblocks down.
  const person = await displayPerson().catch(() => null);
  // only accounts save trips, so only they have a list
  return <GlobeScreen person={person} />;
}
