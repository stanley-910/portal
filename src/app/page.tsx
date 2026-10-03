import { readGuest } from "@/lib/guest";

import { GlobeScreen } from "./globe-screen";

export default async function Home() {
  const guest = await readGuest();
  return <GlobeScreen guestName={guest?.name ?? null} />;
}
