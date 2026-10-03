import { currentPerson } from "@/lib/identity";
import { listMyTrips } from "@/lib/trip/server";

import { GlobeScreen } from "./globe-screen";

export default async function Home() {
  // Each call fails soft: `/` must render as a guest, or with Supabase or Liveblocks down.
  const person = await currentPerson().catch(() => null);
  // only accounts save trips, so only they have a list
  const trips = person?.account ? await listMyTrips(person.id) : [];
  return <GlobeScreen person={person} trips={trips} />;
}
