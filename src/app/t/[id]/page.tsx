import { notFound } from "next/navigation";

import { MAX_NAME, readGuest } from "@/lib/guest";
import { joinTrip } from "@/lib/liveblocks/server";
import { TRIP_ID, tripRoomId } from "@/lib/liveblocks/types";

import { saveName } from "../actions";
import { TripRoom } from "./trip-room";

export default async function TripPage({ params }: PageProps<"/t/[id]">) {
  const { id } = await params;
  if (!TRIP_ID.test(id)) notFound();
  const guest = await readGuest();
  if (!guest?.name) return <NamePrompt />;
  if ((await joinTrip(tripRoomId(id), guest.id)) === null) notFound();
  return <TripRoom tripId={id} />;
}

/** Before joining, everyone picks the name the others will see. */
function NamePrompt() {
  return (
    <main className="grid min-h-dvh place-items-center bg-paper p-(--space-5)">
      <form
        action={saveName}
        className="flex w-full max-w-sm flex-col gap-(--space-3) rounded-ticket border-(length:--line-ink) border-ink bg-paper-raised p-(--space-5) shadow-ticket"
      >
        <label htmlFor="name" className="type-title">
          Join the trip
        </label>
        <p className="type-body text-ink-muted">Your friends see this name next to your cursor.</p>
        <input
          id="name"
          name="name"
          required
          autoFocus
          maxLength={MAX_NAME}
          autoComplete="nickname"
          className="type-body h-11 rounded-tag border-(length:--line-hair) border-ink bg-paper px-(--space-2)"
        />
        <button
          type="submit"
          className="type-stamp h-11 rounded-tag border-(length:--line-ink) border-ink bg-ink text-paper-raised"
        >
          Join
        </button>
      </form>
    </main>
  );
}
