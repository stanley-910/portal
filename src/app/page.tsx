import { currentPerson } from "@/lib/identity";

import { GlobeScreen } from "./globe-screen";

export default async function Home() {
  // Each call fails soft: `/` must render as a guest, or with Supabase or Liveblocks down.
  const person = await currentPerson().catch(() => null);
  // only accounts save trips, so only they have a list
  return <GlobeScreen person={person} />;
}
