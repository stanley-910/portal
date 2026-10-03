import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";

import "@/components/auth/auth.css";
import { Button } from "@/components/paper-atlas";
import { MAX_NAME } from "@/lib/guest";
import { expireBookings } from "@/lib/booking/flow";
import { displayPerson } from "@/lib/identity";
import { liveblocks } from "@/lib/liveblocks/server";
import { TRIP_ID, tripRoomId } from "@/lib/liveblocks/types";
import { tripOwner } from "@/lib/trip/leave";

import { saveName } from "../actions";
import { TripRoom } from "./trip-room";

/** Anyone with the link can join: accounts by their profile name, guests after picking a name. */
export default async function TripPage({ params }: PageProps<"/t/[id]">) {
  const { id } = await params;
  if (!TRIP_ID.test(id)) notFound();
  const [person, room] = await Promise.all([
    displayPerson(), liveblocks().getRoom(tripRoomId(id)).catch(() => null),
  ]);
  if (!person?.name) return <NamePrompt tripPath={`/t/${id}`} />;
  if (!room) notFound();
  // the owner: whoever made the trip, until they leave and it passes on (the room then reads it from Storage)
  const hostId = tripOwner(room.metadata);
  // Joining happens when the room connects (the auth route), never while rendering: a Server Function that sets a
  // cookie, such as a Supabase session refresh, re-renders this page, which would join someone who just left.
  // a group booking past its deadline goes back to planning before anyone acts on it
  after(() => expireBookings(tripRoomId(id)));
  return <TripRoom tripId={id} hostId={hostId} name={person.name} email={person.email} account={person.account} nationalities={person.nationalities} />;
}

/** Before joining, a guest picks the name others will see, or signs in. Styled like the sign-in panel. */
function NamePrompt({ tripPath }: { tripPath: string }) {
  return (
    <main className="au-layer bg-paper">
      <form action={saveName} className="au-panel">
        <div>
          <h1 className="au-title">Join the trip</h1>
          <p className="au-sub">Your friends see this name next to your cursor.</p>
        </div>
        <label className="au-field">
          <span>Your name</span>
          <input name="name" required autoFocus maxLength={MAX_NAME} autoComplete="nickname" className="au-input" />
        </label>
        <Button type="submit" block>
          Join
        </Button>
        <p className="au-sub">
          Have an account?{" "}
          <Link href={`${tripPath}?auth=signin`} scroll={false} className="text-ink underline">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
