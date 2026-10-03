"use client";

import { LiveblocksProvider, RoomProvider, useErrorListener, useStatus, useStorage, useUpdateMyPresence } from "@liveblocks/react";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import { AgentChat } from "@/components/agent/agent-chat";
import { PipCursor } from "@/components/agent/pip-cursor";
import { NavBar, PlaceSearch } from "@/components/nav-bar";
import { AvatarStack } from "@/components/multiplayer/avatar-stack";
import { InviteButton } from "@/components/multiplayer/invite-button";
import { RemoteCursors } from "@/components/multiplayer/remote-cursors";
import { RemotePlanes } from "@/components/multiplayer/remote-planes";
import { TripPlan } from "@/components/multiplayer/trip-plan";
import { TripGlobe, type TripGlobeHandle } from "@/components/trip-globe";
import { tripRoomId } from "@/lib/liveblocks/types";
import { initialTripStorage, usePlanActions, usePlanReady, useRecordMember } from "@/lib/trip/plan";

/** Background tabs disconnect after this long, so forgotten tabs stop using collaboration minutes. */
const BACKGROUND_TIMEOUT = 2 * 60 * 1000;

export function TripRoom({ tripId, name, email, account }: { tripId: string; name: string; email: string | null; account: boolean }) {
  return (
    <LiveblocksProvider
      authEndpoint="/api/liveblocks-auth"
      throttle={32}
      backgroundKeepAliveTimeout={BACKGROUND_TIMEOUT}
    >
      <RoomProvider id={tripRoomId(tripId)} initialPresence={{ cursor: null, flight: null }} initialStorage={initialTripStorage}>
        <TripScreen name={name} email={email} account={account} />
      </RoomProvider>
    </LiveblocksProvider>
  );
}

function TripScreen({ name, email, account }: { name: string; email: string | null; account: boolean }) {
  const { resolvedTheme } = useTheme();
  const globe = useRef<TripGlobeHandle>(null);
  const updateMyPresence = useUpdateMyPresence();
  const status = useStatus();
  // a trip started by talking to Pip on the home globe opens with the chat showing
  const pipOpen = useSearchParams().get("pip") === "open";
  const [full, setFull] = useState(false);
  const { addLeg } = usePlanActions();
  const planReady = usePlanReady();
  // the leg you just landed: your own plane already shows it, so it isn't drawn twice until you move on
  const [landedLeg, setLandedLeg] = useState<string | null>(null);
  // whether that leg is still on the trip, with both its stops: Pip or a friend may have taken it off
  const landedOnTrip = useStorage((root) => {
    const leg = landedLeg ? root.legs[landedLeg] : undefined;
    return !!leg && !!root.stops[leg.from] && !!root.stops[leg.to];
  });
  useEffect(() => {
    // your plane would keep its route and lit country for a leg that's gone, so put it away
    if (landedLeg && landedOnTrip === false) globe.current?.cancel();
  }, [landedLeg, landedOnTrip]);
  useRecordMember();

  useErrorListener((error) => {
    if (error.context.type === "ROOM_CONNECTION_ERROR" && error.context.code === 4005) setFull(true);
  });

  if (full) {
    return (
      <main className="grid min-h-dvh place-items-center bg-paper p-(--space-5)">
        <p className="type-body text-center">This trip is full. Ten people can be in a trip at once.</p>
      </main>
    );
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <TripGlobe
        ref={globe}
        theme={resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : "auto"}
        onPointerLatLng={(cursor) => updateMyPresence({ cursor })}
        onFlightChange={(flight) => updateMyPresence({ flight })}
        onLand={(trip) => planReady && setLandedLeg(addLeg(trip))}
        onTakeoff={() => setLandedLeg(null)}
        onCancel={() => setLandedLeg(null)}
      />
      <RemotePlanes globe={globe} hideLeg={landedLeg} />
      <RemoteCursors globe={globe} />
      <PipCursor globe={globe} />
      <NavBar globe={globe} name={name} email={email} account={account} reloadOnRename>
        <PlaceSearch globe={globe} />
        <AvatarStack />
        <InviteButton />
      </NavBar>
      {/* below the navbar and the globe's cancel button */}
      <div className="absolute top-40 right-(--space-4)">
        <TripPlan />
      </div>
      <AgentChat initialOpen={pipOpen} />
      {status === "reconnecting" || status === "connecting" ? (
        <p role="status" className="type-meta absolute top-(--space-6) left-1/2 -translate-x-1/2 text-ink-muted">
          {status === "connecting" ? "Connecting" : "Reconnecting"}
        </p>
      ) : null}
    </main>
  );
}
