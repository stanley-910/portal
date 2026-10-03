"use client";

import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { HomePip, type HomePipHandle } from "@/components/agent/home-pip";
import { setPendingAction, takePendingAction, useOpenAuth } from "@/components/auth/links";
import { NAV_ICONS, NavBar, NavButton, PlaceSearch } from "@/components/nav-bar";
import { TicketSearch, type PickedStay } from "@/components/ticket-search";
import { CurrencySetting } from "@/components/transport/currency-selector";
import { TripGlobe, type LandedTrip, type TripGlobeHandle } from "@/components/trip-globe";
import type { SoloLeg } from "@/lib/agent/solo";
import { CURRENCIES, type Currency, type ExchangeRates } from "@/lib/currency";
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

/** A local Date as YYYY-MM-DD. */
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

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
  // the legs on the globe as Pip sees them: each picked date, else the earliest it can leave
  const soloTrip = useMemo<SoloLeg[]>(
    () =>
      legs?.map((l, i) => ({
        from: stopFromPoint(l.origin, l.from),
        to: stopFromPoint(l.destination, l.to),
        date: picks[i]?.depart ?? isoDay(l.departDate),
      })) ?? [],
    [legs, picks],
  );
  // Save trip keeps the trip in your account and stays on the globe. Guests sign in first, and the save carries on after.
  const [saving, startSaving] = useTransition();
  const [saveFailed, setSaveFailed] = useState(false);
  const [saved, setSaved] = useState<{ id: string; offer: string | null } | null>(null);
  const router = useRouter();
  // dates for the legs Pip just put on the globe, applied when the globe reports them landed
  const pipDates = useRef<string[] | null>(null);
  const pip = useRef<HomePipHandle>(null);
  const [currency, setCurrency] = useState<Currency>("USD");
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  const [rateError, setRateError] = useState(false);

  const account = person?.account ?? false;
  const openAuth = useOpenAuth();
  const runSave = (input: Parameters<typeof saveSoloTrip>[0]) =>
    startSaving(async () => {
      const result = await saveSoloTrip(input).catch(() => ({ error: "failed" as const }));
      if ("error" in result) return setSaveFailed(true);
      const legs = (input as { legs?: { chosen?: string | null }[] }).legs;
      setSaved({ id: result.id, offer: legs?.at(-1)?.chosen ?? null });
      // the trips list and anything else that shows them
      router.refresh();
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
    else if (pending?.type === "pip") pip.current?.ask(pending.text);
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
      onLand={(flown) => {
        // a trip Pip planned lands like a flown one, then takes Pip's dates
        const dates = pipDates.current;
        pipDates.current = null;
        const landed = dates ? flown.map((l, i) => (dates[i] ? { ...l, departDate: new Date(`${dates[i]}T00:00`) } : l)) : flown;
        setLegs(landed);
        setSaved(null);
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
      settings={<CurrencySetting currency={currency} rates={rates} error={rateError} onChange={setCurrency} />}
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
        addedId={saved?.offer ?? undefined}
        savedHref={saved ? `/t/${saved.id}` : undefined}
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
    <HomePip
      account={account}
      trip={soloTrip}
      onTrip={(planned) => {
        pipDates.current = planned.map((l) => l.date);
        globe.current?.showTrip([planned[0].from, ...planned.map((l) => l.to)]);
      }}
      ref={pip}
    />
  </main>;
}
