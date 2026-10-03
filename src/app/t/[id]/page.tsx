import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";

import "@/components/auth/auth.css";
import { Button } from "@/components/paper-atlas";
import { MAX_NAME } from "@/lib/guest";
import { expireBookings } from "@/lib/booking/flow";
import { currentPerson } from "@/lib/identity";
import { joinTrip, liveblocks } from "@/lib/liveblocks/server";
import { TRIP_ID, tripRoomId } from "@/lib/liveblocks/types";

import { saveName } from "../actions";
import { TripRoom } from "./trip-room";

/** Anyone with the link can join: accounts by their profile name, guests after picking a name. */
export default async function TripPage({ params }: PageProps<"/t/[id]">) {
  const { id } = await params;
  if (!TRIP_ID.test(id)) notFound();
  const person = await currentPerson();
  if (!person?.name) return <NamePrompt tripPath={`/t/${id}`} />;
  const room = await liveblocks().getRoom(tripRoomId(id)).catch(() => null);
  if (!room) notFound();
  if ((await joinTrip(tripRoomId(id), person.id)) === null) notFound();
  // a group booking past its deadline goes back to planning before anyone acts on it
  after(() => expireBookings(tripRoomId(id)));
  return <TripRoom tripId={id} name={person.name} email={person.email} account={person.account} nationalities={person.nationalities} />;
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
