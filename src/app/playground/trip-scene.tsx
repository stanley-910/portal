"use client";

import { useState, type RefObject } from "react";

import { AgentChat } from "@/components/agent/agent-chat";
import { AvatarStack } from "@/components/multiplayer/avatar-stack";
import { InviteButton } from "@/components/multiplayer/invite-button";
import { LegTags } from "@/components/multiplayer/leg-tags";
import { RemotePlanes } from "@/components/multiplayer/remote-planes";
import { RiderPins } from "@/components/multiplayer/rider-pins";
import { TripDock, type DockSpot } from "@/components/multiplayer/trip-dock";
import { FloatingTripPlan, type LegFocus } from "@/components/multiplayer/trip-plan";
import { NavBar, PlaceSearch } from "@/components/nav-bar";
import { CurrencySetting } from "@/components/transport/currency-selector";
import type { TripGlobeHandle } from "@/components/trip-globe";
import { setCurrencyPref, useCurrencyPref } from "@/lib/currency-pref";
import { useExchangeRates } from "@/lib/exchange-rates";
import { usePlanReady } from "@/lib/trip/plan";

import { FakeGlobe } from "./fake-globe";
import { NoParty, PartyRoom } from "./party-room";

// A trip room as TripScreen composes it, on the flat stand-in globe, in the local party trip: the plan card and its
// dock, the legs' ticket stubs, the riders' pins and Pip's trip chat. A leg's route, stub or pins open the plan at it.

export function TripScene({ globe, party, compact }: { globe: RefObject<TripGlobeHandle | null>; party: boolean; compact: boolean }) {
  if (!party) {
    return (
      <main className="grid h-dvh place-items-center bg-paper p-(--space-5)">
        <NoParty className="grid max-w-md gap-(--space-2) text-center" />
      </main>
    );
  }
  return (
    <PartyRoom>
      <Room globe={globe} compact={compact} />
    </PartyRoom>
  );
}

function Room({ globe, compact }: { globe: RefObject<TripGlobeHandle | null>; compact: boolean }) {
  const [planOpen, setPlanOpen] = useState(true);
  const [focus, setFocus] = useState<LegFocus>(null);
  const [billOpen, setBillOpen] = useState(false);
  const [dockSpot, setDockSpot] = useState<DockSpot>(null);
  const planReady = usePlanReady();
  const currency = useCurrencyPref();
  const rates = useExchangeRates();
  const openLeg = (leg?: string) => {
    setPlanOpen(true);
    if (leg) setFocus({ leg, n: Date.now() });
  };
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-paper">
      <FakeGlobe ref={globe} zoom={compact ? 0.5 : 0} onRouteClick={(id) => openLeg(id?.startsWith("leg:") ? id.slice("leg:".length) : undefined)} />
      <RemotePlanes globe={globe} hideLegs={[]} />
      <NavBar
        globe={globe}
        name="Kit"
        account={false}
        nationalities={["HKG"]}
        settings={<CurrencySetting currency={currency} rates={rates} error={false} onChange={setCurrencyPref} />}
      >
        <PlaceSearch globe={globe} />
        <AvatarStack />
        <InviteButton />
      </NavBar>
      <RiderPins globe={globe} onOpen={openLeg} />
      <LegTags globe={globe} onOpen={openLeg} />
      {planOpen ? (
        <FloatingTripPlan globe={globe} nationalities={["HKG"]} focus={focus} bill={{ open: billOpen, set: setBillOpen }} onMinimise={() => {
            setPlanOpen(false);
            setFocus(null);
          }}
        />
      ) : planReady ? (
        <TripDock spot={dockSpot} onMove={setDockSpot} bill={{ open: billOpen, set: setBillOpen }} onExpand={() => setPlanOpen(true)} />
      ) : null}
      <AgentChat />
    </main>
  );
}
