"use client";

import { LiveblocksProvider, RoomProvider, useErrorListener, useEventListener, useRoom, useSelf, useStatus, useStorage, useUpdateMyPresence } from "@liveblocks/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Activity, useEffect, useRef, useState } from "react";

import { AgentChat } from "@/components/agent/agent-chat";
import { PipCursor } from "@/components/agent/pip-cursor";
import { MenuSection, NavBar, PlaceSearch } from "@/components/nav-bar";
import { AvatarStack } from "@/components/multiplayer/avatar-stack";
import { InviteButton } from "@/components/multiplayer/invite-button";
import { RemoteCursors } from "@/components/multiplayer/remote-cursors";
import { RemotePlanes } from "@/components/multiplayer/remote-planes";
import { useCursorPref } from "@/lib/cursor-pref";
import { CurrencySetting } from "@/components/transport/currency-selector";
import { setCurrencyPref, useCurrencyPref } from "@/lib/currency-pref";
import { useExchangeRates } from "@/lib/exchange-rates";
import { LegTags } from "@/components/multiplayer/leg-tags";
import { RiderPins } from "@/components/multiplayer/rider-pins";
import { FloatingTripPlan, type LegFocus } from "@/components/multiplayer/trip-plan";
import { TripDock, type DockSpot } from "@/components/multiplayer/trip-dock";
import { Button } from "@/components/paper-atlas";
import { EndTripDialog, LeaveTripDialog } from "@/components/trip-plan/leave-trip";
import { ClickHint, TripGlobe, type TripGlobeHandle } from "@/components/trip-globe";
import { tripRoomId } from "@/lib/liveblocks/types";
import { initialTripStorage, useMemberColor, usePlanActions, usePlanReady, useRecordMember } from "@/lib/trip/plan";
import { usePlanIssueWatch } from "@/lib/trip/issue-watch";

/** Background tabs disconnect after this long, so forgotten tabs stop using collaboration minutes. */
const BACKGROUND_TIMEOUT = 2 * 60 * 1000;

type Me = { name: string; email: string | null; account: boolean; nationalities: string[] };

export function TripRoom({ tripId, hostId, ...me }: { tripId: string; hostId: string | null } & Me) {
  return (
    <LiveblocksProvider
      authEndpoint="/api/liveblocks-auth"
      baseUrl={process.env.NEXT_PUBLIC_LIVEBLOCKS_BASE_URL}
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
  // your cursor's shape is yours; its colour is your colour in this trip, as the plan stores it
  const cursorShape = useCursorPref().shape;
  const updateMyPresence = useUpdateMyPresence();
  // others see your cursor in the shape you picked, and change with it
  useEffect(() => {
    updateMyPresence({ shape: cursorShape });
  }, [cursorShape, updateMyPresence]);
  const myId = useSelf((me) => me.id);
  const tokenColor = useSelf((me) => me.info.color) ?? 1;
  // the room numbers colours from 1; the design system's slots count from 0
  const color = useMemberColor(myId, tokenColor) - 1;
  // the owner as the plan has it, so it updates when they leave and the trip passes on; else whoever made the trip
  const owner = useStorage((root) => root.owner) ?? hostId;
  const status = useStatus();
  // a trip started by talking to Pip on the home globe opens with the chat showing
  const params = useSearchParams();
  const pipOpen = params.get("pip") === "open";
  // a trip saved from the home globe with Book opens at that leg's booking
  const bookLeg = params.get("book");
  const [full, setFull] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [ending, setEnding] = useState(false);
  // the owner ended the trip: its room is gone, so there's nothing to reconnect to
  const [ended, setEnded] = useState(false);
  const room = useRoom();
  const { addLeg, setColor } = usePlanActions();
  const planReady = usePlanReady();
  // the leg you just landed: your own plane already shows it, so it isn't drawn twice until you move on
  const [landedLegs, setLandedLegs] = useState<string[]>([]);
  // the date picked in the From and To search, which the route it draws lands on
  const searchDate = useRef<string | null>(null);
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
  // the leg asked for on the globe, which the plan opens at
  const [focus, setFocus] = useState<LegFocus>(null);
  const openLeg = (leg?: string) => {
    setPlanOpen(true);
    if (leg) setFocus({ leg, n: Date.now() });
  };
  // the bill stays open or shut as the plan folds to its dock and back; the dock stays where it was dragged
  const [billOpen, setBillOpen] = useState(false);
  const [dockSpot, setDockSpot] = useState<DockSpot>(null);
  const currency = useCurrencyPref();
  const rates = useExchangeRates();
  useRecordMember(nationalities);
  usePlanIssueWatch(tripId);

  useErrorListener((error) => {
    if (error.context.type !== "ROOM_CONNECTION_ERROR") return;
    if (error.context.code === 4005) setFull(true);
    // reconnecting after the room was deleted: the auth route answers 404, and Liveblocks stops retrying (code -1)
    if (error.context.code === -1 && error.message.includes("(404 returned")) setEnded(true);
  });
  // only the server sends this (`user` is null), so a member can't end the trip on anyone's screen
  useEventListener(({ event, user }) => {
    if (event.type !== "trip-ended" || user !== null) return;
    room.disconnect();
    setEnded(true);
  });

  if (ended) {
    return (
      <main className="grid min-h-dvh place-items-center bg-paper p-(--space-5)">
        <div className="grid justify-items-center gap-(--space-3) text-center">
          <p className="type-body">This trip has ended.</p>
          <Link href="/" className="pa-btn pa-btn-secondary no-underline">
            <span>Back to globe</span>
          </Link>
        </div>
      </main>
    );
  }

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
        onLand={(legs) => {
          const date = searchDate.current;
          searchDate.current = null;
          const landed = date ? legs.map((l) => ({ ...l, departDate: new Date(`${date}T00:00`) })) : legs;
          if (planReady) setLandedLegs(landed.map(addLeg));
        }}
        onTakeoff={() => setLandedLegs([])}
        onCancel={() => {
          searchDate.current = null;
          setLandedLegs([]);
        }}
        onRouteClick={(id) => openLeg(id?.startsWith("leg:") ? id.slice("leg:".length) : undefined)}
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
        tripColor={planReady ? { slot: color, onChange: (slot) => setColor(slot + 1) } : undefined}
        settings={
          <>
            <CurrencySetting currency={currency} rates={rates} error={false} onChange={setCurrencyPref} />
            <MenuSection title="This trip">
              <Button variant="quiet" onClick={() => setLeaving(true)}>
                Leave trip
              </Button>
              {myId && myId === owner ? (
                <Button variant="quiet" onClick={() => setEnding(true)}>
                  End trip
                </Button>
              ) : null}
            </MenuSection>
          </>
        }
      >
        <PlaceSearch
          globe={globe}
          onRoute={(from, to, date) => {
            // the route draws out to the two places and lands on the picked date, like a flown leg
            searchDate.current = date;
            globe.current?.showTrip([from, to], "draw");
          }}
        />
        <AvatarStack />
        <InviteButton />
      </NavBar>
      <RiderPins globe={globe} onOpen={openLeg} />
      <LegTags globe={globe} onOpen={openLeg} />
      <Activity mode={planOpen ? "visible" : "hidden"}>
        <FloatingTripPlan
          globe={globe}
          bookLeg={bookLeg}
          focus={focus}
          bill={{ open: billOpen, set: setBillOpen }}
          onMinimise={() => {
            setPlanOpen(false);
            // a leg asked for once isn't asked for again the next time the plan opens
            setFocus(null);
          }}
        />
      </Activity>
      {!planOpen && planReady ? (
        <TripDock spot={dockSpot} onMove={setDockSpot} bill={{ open: billOpen, set: setBillOpen }} onExpand={() => setPlanOpen(true)} />
      ) : null}
      {/* how to draw a leg, in the bottom-left corner */}
      <ClickHint color={color} />
      <AgentChat initialOpen={pipOpen} />
      {leaving ? (
        <LeaveTripDialog
          tripId={tripId}
          next={account ? "/?trips" : "/"}
          onClose={() => setLeaving(false)}
          connection={{ pause: () => room.disconnect(), resume: () => room.connect() }}
        />
      ) : null}
      {ending ? (
        <EndTripDialog
          tripId={tripId}
          next={account ? "/?trips" : "/"}
          onClose={() => setEnding(false)}
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
