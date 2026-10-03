"use client";

import { LiveblocksProvider, RoomProvider, useErrorListener, useRoom, useSelf, useStatus, useStorage, useUpdateMyPresence } from "@liveblocks/react";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import { AgentChat } from "@/components/agent/agent-chat";
import { PipCursor } from "@/components/agent/pip-cursor";
import { MenuSection, NavBar, PlaceSearch } from "@/components/nav-bar";
import { AvatarStack } from "@/components/multiplayer/avatar-stack";
import { InviteButton } from "@/components/multiplayer/invite-button";
import { RemoteCursors } from "@/components/multiplayer/remote-cursors";
import { RemotePlanes } from "@/components/multiplayer/remote-planes";
import { useCursorPref } from "@/lib/cursor-pref";
import { LegTags } from "@/components/multiplayer/leg-tags";
import { TripPlan } from "@/components/multiplayer/trip-plan";
import { Button } from "@/components/paper-atlas";
import { LeaveTripDialog } from "@/components/trip-plan/leave-trip";
import { TripGlobe, type TripGlobeHandle } from "@/components/trip-globe";
import { tripRoomId } from "@/lib/liveblocks/types";
import { initialTripStorage, usePlanActions, usePlanLegs, usePlanReady, useRecordMember } from "@/lib/trip/plan";

/** Background tabs disconnect after this long, so forgotten tabs stop using collaboration minutes. */
const BACKGROUND_TIMEOUT = 2 * 60 * 1000;

type Me = { name: string; email: string | null; account: boolean; nationalities: string[] };

export function TripRoom({ tripId, hostId, ...me }: { tripId: string; hostId: string | null } & Me) {
  return (
    <LiveblocksProvider
      authEndpoint="/api/liveblocks-auth"
      throttle={32}
      backgroundKeepAliveTimeout={BACKGROUND_TIMEOUT}
    >
      <RoomProvider id={tripRoomId(tripId)} initialPresence={{ cursor: null, flight: null }} initialStorage={initialTripStorage}>
        <TripScreen tripId={tripId} {...me} hostId={hostId} />
      </RoomProvider>
    </LiveblocksProvider>
  );
}

function TripScreen({ tripId, name, email, account, nationalities, hostId }: { tripId: string; hostId: string | null } & Me) {
  const { resolvedTheme } = useTheme();
  const globe = useRef<TripGlobeHandle>(null);
  // your cursor's shape is yours; its colour is the one the room gave you
  const cursorShape = useCursorPref().shape;
  const updateMyPresence = useUpdateMyPresence();
  // the room numbers colours from 1; the design system's slots count from 0
  const color = useSelf((me) => me.info.color - 1) ?? 0;
  const status = useStatus();
  // a trip started by talking to Pip on the home globe opens with the chat showing
  const pipOpen = useSearchParams().get("pip") === "open";
  const [full, setFull] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const room = useRoom();
  const { addLeg } = usePlanActions();
  const planReady = usePlanReady();
  // the leg you just landed: your own plane already shows it, so it isn't drawn twice until you move on
  const [landedLegs, setLandedLegs] = useState<string[]>([]);
  // whether those legs are all still on the trip, with their stops: Pip or a friend may have taken one off
  const landedOnTrip = useStorage((root) =>
    landedLegs.every((id) => {
      const leg = root.legs[id];
      return !!leg && !!root.stops[leg.from] && !!root.stops[leg.to];
    }),
  );
  useEffect(() => {
    // your plane would keep its route and lit country for a leg that's gone, so put it away; the legs left on
    // the trip are drawn like everyone else's again
    if (landedLegs.length && landedOnTrip === false) globe.current?.cancel();
  }, [landedLegs, landedOnTrip]);
  // the plan panel; folded away, each leg's ticket stub on its route opens it again
  const [planOpen, setPlanOpen] = useState(true);
  // your own vehicle still stands in for the last of those legs, so it parks as that leg's chosen offer
  const planLegs = usePlanLegs();
  const landedMode = planLegs?.find((leg) => leg.id === landedLegs.at(-1))?.chosen?.mode ?? "flight";
  useEffect(() => globe.current?.setVehicle(landedMode), [landedMode]);
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
        color={color}
        cursorShape={cursorShape}
        theme={resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : "auto"}
        onPointerLatLng={(cursor) => updateMyPresence({ cursor })}
        onFlightChange={(flight) => updateMyPresence({ flight })}
        onLand={(legs) => planReady && setLandedLegs(legs.map(addLeg))}
        onTakeoff={() => setLandedLegs([])}
        onCancel={() => setLandedLegs([])}
        onRouteClick={() => setPlanOpen(true)}
      />
      <RemotePlanes globe={globe} hideLegs={landedLegs} />
      <RemoteCursors globe={globe} />
      <PipCursor globe={globe} />
      <NavBar
        globe={globe}
        name={name}
        email={email}
        account={account}
        nationalities={nationalities}
        reloadOnRename
        settings={
          <MenuSection title="This trip">
            <Button variant="quiet" onClick={() => setLeaving(true)}>
              Leave trip
            </Button>
          </MenuSection>
        }
      >
        <PlaceSearch globe={globe} />
        <AvatarStack />
        <InviteButton />
      </NavBar>
      <LegTags globe={globe} onOpen={() => setPlanOpen(true)} />
      {/* below the navbar */}
      {planOpen ? (
        <div className="absolute top-40 right-(--space-4)">
          <TripPlan hostId={hostId} email={email} nationalities={nationalities} onMinimise={() => setPlanOpen(false)} />
        </div>
      ) : null}
      <AgentChat initialOpen={pipOpen} />
      {leaving ? (
        <LeaveTripDialog
          tripId={tripId}
          next={account ? "/trips" : "/"}
          onClose={() => setLeaving(false)}
          connection={{ pause: () => room.disconnect(), resume: () => room.connect() }}
        />
      ) : null}
      {status === "reconnecting" || status === "connecting" ? (
        <p role="status" className="type-meta absolute top-(--space-6) left-1/2 -translate-x-1/2 text-ink-muted">
          {status === "connecting" ? "Connecting" : "Reconnecting"}
        </p>
      ) : null}
    </main>
  );
}
