"use client";

import { LiveblocksProvider, RoomProvider } from "@liveblocks/react";
import type { ReactNode } from "react";

import { tripRoomId } from "@/lib/liveblocks/types";
import { initialTripStorage, usePlanReady, useRecordMember } from "@/lib/trip/plan";

// The trip `pnpm dev:party` seeds into the local Liveblocks dev server: Mei, Ada, Joon and Sam meeting in Shanghai and
// Tokyo. Edits land in that local room only, and every start of dev:party seeds it fresh.

export const PARTY_TRIP = "partyTestRoom001";

/** You join the party as a guest with a Hong Kong passport, so the plan's riders and entry rules include you. */
function Member({ children }: { children: ReactNode }) {
  useRecordMember(["HKG"]);
  return children;
}

export function PartyRoom({ children }: { children: ReactNode }) {
  return (
    <LiveblocksProvider authEndpoint="/api/liveblocks-auth" baseUrl={process.env.NEXT_PUBLIC_LIVEBLOCKS_BASE_URL} throttle={32}>
      <RoomProvider id={tripRoomId(PARTY_TRIP)} initialPresence={{ cursor: null, flight: null }} initialStorage={initialTripStorage}>
        <Member>{children}</Member>
      </RoomProvider>
    </LiveblocksProvider>
  );
}

/** What shows in place of the room when the local Liveblocks server isn't running. */
export function NoParty({ className }: { className?: string }) {
  return (
    <div className={className}>
      <p className="type-body">The trip room needs the local Liveblocks server.</p>
      <p className="type-meta text-ink-muted">
        Stop the dev server and run <code>pnpm dev:party</code>. It seeds a four-person trip this page joins as a guest.
      </p>
    </div>
  );
}

/** Children once the room's plan has loaded. */
export function WhenReady({ children }: { children: ReactNode }) {
  return usePlanReady() ? children : <p className="type-meta text-ink-muted">Joining the trip…</p>;
}
