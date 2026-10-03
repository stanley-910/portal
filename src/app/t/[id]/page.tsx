import { notFound, redirect } from "next/navigation";

import { joinTrip } from "@/lib/liveblocks/server";
import { TRIP_ID, tripRoomId } from "@/lib/liveblocks/types";
import { getCurrentUser } from "@/lib/supabase/server";

import { TripRoom } from "./trip-room";

/** A trip needs an account (M19): signed-out visitors go through sign-in and come back here. */
export default async function TripPage({ params }: PageProps<"/t/[id]">) {
  const { id } = await params;
  if (!TRIP_ID.test(id)) notFound();
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/t/${id}`);
  if ((await joinTrip(tripRoomId(id), user.id)) === null) notFound();
  return <TripRoom tripId={id} name={user.displayName} email={user.email} />;
}
