import { displayPerson } from "@/lib/identity";

import { GlobeScreen } from "./globe-screen";

export default async function Home({ searchParams }: { searchParams: Promise<{ trips?: string | string[] }> }) {
  // Each call fails soft: `/` must render as a guest, or with Supabase or Liveblocks down.
  const person = await displayPerson().catch(() => null);
  // `/?trips` opens the library: where My trips links go, and where leaving a trip lands
  const { trips } = await searchParams;
  return <GlobeScreen person={person} openTrips={trips !== undefined} />;
}
