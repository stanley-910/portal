import { getCurrentUser } from "@/lib/supabase/server";
import { listMyTrips } from "@/lib/trip/server";

import { GlobeScreen } from "./globe-screen";

export default async function Home() {
  // Each call fails soft: `/` must render signed out, or with Supabase or Liveblocks down.
  const user = await getCurrentUser().catch(() => null);
  const trips = user ? await listMyTrips(user.id) : [];
  return <GlobeScreen user={user} trips={trips} />;
}
