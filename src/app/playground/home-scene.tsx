"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";

import { HomePip } from "@/components/agent/home-pip";
import { PinTarget } from "@/components/multiplayer/rider-pins";
import { NAV_ICONS, NavBar, NavButton, PlaceSearch } from "@/components/nav-bar";
import { TicketSearch } from "@/components/ticket-search";
import { SoloCheckout } from "@/components/ticket-search/solo-checkout";
import { CurrencySetting } from "@/components/transport/currency-selector";
import type { LandedTrip, LatLng, TripGlobeHandle } from "@/components/trip-globe";
import type { SoloLeg } from "@/lib/agent/solo";
import { setCurrencyPref, useCurrencyPref } from "@/lib/currency-pref";
import { useCursorPref } from "@/lib/cursor-pref";
import { useExchangeRates } from "@/lib/exchange-rates";
import { returnLegPick, type LegPick } from "@/lib/trip/solo-input";
import { stopFromPoint } from "@/lib/trip/stops";

import { CHECKOUT_STAND_IN } from "./checkout-stand-in";
import { FakeGlobe } from "./fake-globe";
import type { Persona } from "./fixtures";

// The home globe's overlays as GlobeScreen composes them, on the flat stand-in globe. Saving, booking and planning
// with friends do nothing here: Save waits a moment and shows its saved state, so every state of the card can be seen.

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function dayAfter(iso: string) {
  const d = new Date(`${iso}T00:00`);
  d.setDate(d.getDate() + 1);
  return d;
}

export function HomeScene({
  globe,
  persona,
  compact,
  initial,
}: {
  globe: RefObject<TripGlobeHandle | null>;
  persona: Persona;
  compact: boolean;
  /** Stops to land on mount, or none for an empty globe. */
  initial: LatLng[] | null;
}) {
  const cursorPref = useCursorPref();
  const [legs, setLegs] = useState<LandedTrip[] | null>(null);
  const [active, setActive] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [picks, setPicks] = useState<LegPick[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const trip = legs?.[active] ?? null;
  const currency = useCurrencyPref();
  const rates = useExchangeRates();

  const soloTrip = useMemo<SoloLeg[]>(
    () =>
      legs?.map((l, i) => ({
        from: stopFromPoint(l.origin, l.from),
        to: stopFromPoint(l.destination, l.to),
        date: picks[i]?.depart ?? isoDay(l.departDate),
      })) ?? [],
    [legs, picks],
  );

  useEffect(() => {
    if (initial) globe.current?.showTrip(initial);
    else globe.current?.cancel();
    // the scene's trip, once per preset
  }, [globe, initial]);

  useEffect(() => {
    const g = globe.current;
    if (!g || !legs) return;
    g.setPins(legs.map((l, i) => ({ key: `you:${i}`, stop: `stop:${i}`, at: l.destination, color: cursorPref.color })));
  }, [globe, legs, cursorPref.color]);

  const fakeSave = (offerId: string | null) => {
    setSaving(true);
    window.setTimeout(() => {
      setSaving(false);
      setSaved(offerId ?? "saved");
    }, 900);
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-paper">
      <FakeGlobe
        ref={globe}
        zoom={compact ? 0.5 : 0}
        onTakeoff={() => {
          setLegs(null);
          globe.current?.setPins([]);
        }}
        onLand={(flown) => {
          setLegs(flown);
          setActive(0);
          setCollapsed(false);
          setPicks([]);
          setSaved(null);
          setBooking(false);
        }}
        onCancel={() => {
          setLegs(null);
          globe.current?.setPins([]);
        }}
        onRouteClick={() => setCollapsed(false)}
      />
      {legs ? (
        <div className="pointer-events-none absolute inset-0 isolate overflow-hidden">
          {legs.map((_, i) => (
            <PinTarget
              key={`stop:${i}`}
              globe={globe}
              stop={{ id: `stop:${i}`, name: soloTrip[i]?.to.name ?? "this stop" }}
              who="You"
              onOpen={() => setCollapsed(false)}
              onMove={(place) => {
                const points = [legs[0].origin, ...legs.map((l) => l.destination)];
                points[i + 1] = place.at;
                globe.current?.showTrip(points, "quiet");
                return null;
              }}
            />
          ))}
        </div>
      ) : null}
      <NavBar
        globe={globe}
        name={persona.name}
        email={persona.email}
        account={persona.account}
        nationalities={persona.nationalities}
        color={persona.color}
        settings={<CurrencySetting currency={currency} rates={rates} error={false} onChange={setCurrencyPref} />}
      >
        {/* the flat globe lands the route at once, on tomorrow's date: the draw-out and the picked date are the real globe's */}
        <PlaceSearch globe={globe} onRoute={(from, to) => globe.current?.showTrip([from, to], "draw")} />
        <form onSubmit={(e) => e.preventDefault()}>
          <NavButton type="submit" icon={NAV_ICONS.friends} label="Plan with friends" />
        </form>
      </NavBar>
      {trip ? (
        <TicketSearch
          key={`${active}:${trip.origin.lat},${trip.origin.lng}-${trip.destination.lat},${trip.destination.lng}@${trip.departDate.getTime()}`}
          trip={trip}
          globe={globe}
          currency={currency}
          rates={rates}
          saving={saving}
          addedId={saved ?? undefined}
          savedHref={saved ? "#saved" : undefined}
          home={legs![0]}
          step={{
            index: active,
            count: legs!.length,
            onBack:
              active > 0
                ? () => {
                    setPicks(picks.slice(0, legs!.length));
                    setActive(active - 1);
                  }
                : undefined,
          }}
          onAdd={({ offer, offers, depart, return: back, stay }) => {
            const last = active === legs!.length - 1;
            const done = [...picks.slice(0, active), { offer, offers, depart, stay }, ...(last && back ? [returnLegPick(back)] : [])];
            setPicks(done);
            if (!last) {
              setLegs(legs!.map((l, i) => (i === active + 1 ? { ...l, departDate: dayAfter(depart) } : l)));
              setActive(active + 1);
              return;
            }
            fakeSave((back?.offer ?? offer)?.id ?? null);
          }}
          onBook={() => setBooking(true)}
          // the playground's fares come from mock providers, none bookable: Book shows anyway, to walk checkout
          canBook
          checkout={
            booking ? (
              <SoloCheckout
                tripId="playground"
                legId={`leg:${active}`}
                email={persona.email}
                nationalities={persona.nationalities}
                onClose={() => setBooking(false)}
                actions={CHECKOUT_STAND_IN}
              />
            ) : undefined
          }
          onDismiss={() => globe.current?.cancel()}
          collapsed={collapsed}
          onCollapse={() => setCollapsed(true)}
          onExpand={() => setCollapsed(false)}
          riders={[{ id: "you", name: "You", passport: persona.nationalities[0] ?? null, passports: persona.nationalities.slice(1), onwardCountry: legs?.[active + 1]?.to?.country ?? null }]}
        />
      ) : null}
      <HomePip
        globe={globe}
        account={persona.account}
        trip={soloTrip}
        onTrip={(planned) => globe.current?.showTrip([planned[0].from, ...planned.map((l) => l.to)])}
      />
    </main>
  );
}
