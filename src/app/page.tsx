import { getCurrentUser } from "@/lib/supabase/server";

import { GlobeScreen } from "./globe-screen";

export default async function Home() {
  const user = await getCurrentUser();
  return <GlobeScreen user={user} />;
}
