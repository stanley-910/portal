"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState, useTransition } from "react";

import { HomePip, startTrip } from "@/components/agent/home-pip";
import { setPendingAction, takePendingAction, useOpenAuth } from "@/components/auth/links";
import { NAV_ICONS, NavBar, NavButton, PlaceSearch } from "@/components/nav-bar";
import { TicketSearch, type PickedStay } from "@/components/ticket-search";
import { CurrencySetting } from "@/components/transport/currency-selector";
import { TripGlobe, type LandedTrip, type TripGlobeHandle } from "@/components/trip-globe";
import { CURRENCIES, type ExchangeRates } from "@/lib/currency";
import { setCurrencyPref, useCurrencyPref } from "@/lib/currency-pref";
import { useCursorPref } from "@/lib/cursor-pref";
import type { Person } from "@/lib/identity";
import type { Offer } from "@/lib/transport/types";
import { MAX_OFFERS } from "@/lib/trip/offers";
import { stopFromPoint } from "@/lib/trip/stops";

import { createTrip } from "./t/actions";
import { saveSoloTrip } from "./t/save-actions";

/** The options saved with the leg: the search's own order, cut to what a room keeps, always including the pick. */
function savedOptions(offer: Offer, offers: Offer[]): Offer[] {
  const kept = offers.slice(0, MAX_OFFERS);
  if (!kept.some((o) => o.id === offer.id)) kept[kept.length ? kept.length - 1 : 0] = offer;
  return kept;
}

type LegPick = { offer: Offer | null; offers: Offer[]; depart: string; stay: PickedStay | null };

/** The day after an ISO date, as a local Date: the earliest the next leg can leave. */
function dayAfter(iso: string) {
  const d = new Date(`${iso}T00:00`);
  d.setDate(d.getDate() + 1);
  return d;
}

export function GlobeScreen({ person }: { person: Person | null }) {
  const { resolvedTheme } = useTheme();
  const globe = useRef<TripGlobeHandle>(null);
  const cursorPref = useCursorPref();
  // the landed trip's legs, the one the popover shows, and what was picked on the legs before it
  const [legs, setLegs] = useState<LandedTrip[] | null>(null);
  const [active, setActive] = useState(0);
  // the ticket card minimised to a tag on the route
  const [collapsed, setCollapsed] = useState(false);
  const [picks, setPicks] = useState<LegPick[]>([]);
  const trip = legs?.[active] ?? null;
  // Save trip makes a new trip room and opens it. Guests sign in first, and the save carries on after.
  const [saving, startSaving] = useTransition();
  const [saveFailed, setSaveFailed] = useState(false);
  const currency = useCurrencyPref();
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  const [rateError, setRateError] = useState(false);

  const account = person?.account ?? false;
  const openAuth = useOpenAuth();
  const runSave = (input: Parameters<typeof saveSoloTrip>[0]) =>
    startSaving(async () => {
      const result = await saveSoloTrip(input).catch(() => ({ error: "failed" as const }));
      if (result?.error) setSaveFailed(true);
    });
  const save = (input: Parameters<typeof saveSoloTrip>[0]) => {
    setSaveFailed(false);
    runSave(input);
  };

  // back from signing in: finish what sent them there
  useEffect(() => {
    if (!account) return;
    const pending = takePendingAction();
    if (pending?.type === "save") runSave(pending.input);
    else if (pending?.type === "create") startSaving(() => createTrip());
    else if (pending?.type === "pip") startSaving(() => startTrip(pending.text));
    // once, on load as an account
  }, [account]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/exchange-rates", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Exchange rates unavailable");
        const result = await response.json() as { rates: ExchangeRates };
        if (CURRENCIES.some((option) => !Number.isFinite(result.rates?.[option]) || result.rates[option] <= 0)) {
          throw new Error("Invalid exchange rates");
        }
        if (!controller.signal.aborted) setRates(result.rates);
      })
      .catch(() => { if (!controller.signal.aborted) setRateError(true); });
    return () => controller.abort();
  }, []);

  return <main className="relative h-dvh w-full overflow-hidden">
    <TripGlobe
      ref={globe}
      color={cursorPref.color}
      cursorShape={cursorPref.shape}
      theme={resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : "auto"}
      onTakeoff={() => setLegs(null)}
      onLand={(landed) => {
        setLegs(landed);
        setActive(0);
        setCollapsed(false);
        setPicks([]);
        setSaveFailed(false);
      }}
      onCancel={() => setLegs(null)}
      onRouteClick={() => setCollapsed(false)}
    />
    <NavBar
      globe={globe}
      name={person?.name ?? null}
      email={person?.email ?? null}
      account={person?.account ?? false}
      nationalities={person?.nationalities}
      settings={<CurrencySetting currency={currency} rates={rates} error={rateError} onChange={setCurrencyPref} />}
    >
      <PlaceSearch globe={globe} />
      <form
        action={createTrip}
        onSubmit={(e) => {
          if (account) return;
          e.preventDefault();
          setPendingAction({ type: "create" });
          openAuth("signup");
        }}
      >
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
        error={saveFailed ? "Couldn't save the trip. Please try again." : null}
        step={{ index: active, count: legs!.length, onBack: active > 0 ? () => setActive(active - 1) : undefined }}
        onAdd={({ offer, offers, depart, stay }) => {
          const done = [...picks.slice(0, active), { offer, offers, depart, stay }];
          setPicks(done);
          if (active < legs!.length - 1) {
            // the next leg leaves no earlier than the day after this one
            setLegs(legs!.map((l, i) => (i === active + 1 ? { ...l, departDate: dayAfter(depart) } : l)));
            setActive(active + 1);
            return;
          }
          const input = {
            legs: legs!.map((l, i) => ({
              from: stopFromPoint(l.origin, l.from),
              to: stopFromPoint(l.destination, l.to),
              date: done[i].depart,
              offers: done[i].offer ? savedOptions(done[i].offer!, done[i].offers) : [],
              chosen: done[i].offer?.id ?? null,
              ...(done[i].stay ? { stay: done[i].stay } : {}),
            })),
          };
          if (account) return save(input);
          setPendingAction({ type: "save", input });
          openAuth("signup");
        }}
        onDismiss={() => globe.current?.cancel()}
        onChoiceMode={(mode) => globe.current?.setVehicle(mode ?? "flight")}
        collapsed={collapsed}
        onCollapse={() => setCollapsed(true)}
        onExpand={() => setCollapsed(false)}
      />
    ) : null}
    <HomePip account={account} />
  </main>;
}
