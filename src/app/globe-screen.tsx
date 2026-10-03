"use client";

import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { HomePip, type HomePipHandle } from "@/components/agent/home-pip";
import { setPendingAction, takePendingAction, useOpenAuth } from "@/components/auth/links";
import { NAV_ICONS, NavBar, NavButton, PlaceSearch } from "@/components/nav-bar";
import { TicketSearch } from "@/components/ticket-search";
import { CurrencySetting } from "@/components/transport/currency-selector";
import { TripGlobe, type LandedTrip, type TripGlobeHandle } from "@/components/trip-globe";
import type { SoloLeg } from "@/lib/agent/solo";
import { CURRENCIES, type ExchangeRates } from "@/lib/currency";
import { setCurrencyPref, useCurrencyPref } from "@/lib/currency-pref";
import { useCursorPref } from "@/lib/cursor-pref";
import type { Person } from "@/lib/identity";
import { returnLegPick, soloSaveInput, type LegPick } from "@/lib/trip/solo-input";
import { stopFromPoint } from "@/lib/trip/stops";

import { createTrip } from "./t/actions";
import { saveSoloTrip } from "./t/save-actions";

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
  // one per leg picked so far, plus one more for a round trip: the way back from the last stop to the first
  const [picks, setPicks] = useState<LegPick[]>([]);
  const trip = legs?.[active] ?? null;
  const goesHome = !!legs && picks.length > legs.length;
  // the legs on the globe as Pip sees them, the way back included: each picked date, else the earliest it can leave
  const soloTrip = useMemo<SoloLeg[]>(() => {
    const out: SoloLeg[] =
      legs?.map((l, i) => ({
        from: stopFromPoint(l.origin, l.from),
        to: stopFromPoint(l.destination, l.to),
        date: picks[i]?.depart ?? isoDay(l.departDate),
      })) ?? [];
    if (legs && picks.length > legs.length) out.push({ from: out.at(-1)!.to, to: out[0].from, date: picks[legs.length].depart });
    return out;
  }, [legs, picks]);
  // the way back, once picked, draws home like a saved leg, and your pin drops at home
  const color = cursorPref.color;
  useEffect(() => {
    const g = globe.current;
    if (!g || !legs) return;
    const home = legs[0].origin;
    g.setRemoteFlights(goesHome ? [{ id: "you:back", origin: legs.at(-1)!.destination, at: home, ahead: home, landed: true, color }] : []);
    const pins = legs.map((leg, i) => ({ key: `you:${i}`, stop: `stop:${i}`, at: leg.destination, color }));
    g.setPins(goesHome ? [...pins, { key: "you:back", stop: "stop:home", at: home, color }] : pins);
    return () => g.setRemoteFlights([]);
  }, [legs, goesHome, color]);
  // Save trip keeps the trip in your account and stays on the globe. Guests sign in first, and the save carries on after.
  const [saving, startSaving] = useTransition();
  const [saveFailed, setSaveFailed] = useState(false);
  const [saved, setSaved] = useState<{ id: string; offer: string | null } | null>(null);
  // dates for the legs Pip just put on the globe, applied when the globe reports them landed
  const pipDates = useRef<string[] | null>(null);
  const pip = useRef<HomePipHandle>(null);
  const currency = useCurrencyPref();
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  const [rateError, setRateError] = useState(false);

  const account = person?.account ?? false;
  const openAuth = useOpenAuth();
  const runSave = (input: Parameters<typeof saveSoloTrip>[0]) =>
    startSaving(async () => {
      const result = await saveSoloTrip(input).catch(() => ({ error: "failed" as const }));
      if ("error" in result) return setSaveFailed(true);
      const legs = (input as { legs?: { chosen?: string | null }[] }).legs;
      // No refresh: nothing on the globe screen shows saved trips, and /trips is dynamic, so it reads them fresh when
      // opened. A refresh here re-rendered the whole screen and held the button on "Saving" for another round trip.
      setSaved({ id: result.id, offer: legs?.at(-1)?.chosen ?? null });
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
      onTakeoff={() => {
        setLegs(null);
        globe.current?.setPins([]);
      }}
      onLand={(flown) => {
        // a trip Pip planned lands like a flown one, then takes Pip's dates
        const dates = pipDates.current;
        pipDates.current = null;
        const landed = dates ? flown.map((l, i) => (dates[i] ? { ...l, departDate: new Date(`${dates[i]}T00:00`) } : l)) : flown;
        // your pin drops at each stop once your plane has landed and gone
        globe.current?.setPins(landed.map((leg, i) => ({ key: `you:${i}`, stop: `stop:${i}`, at: leg.destination, color: cursorPref.color })));
        setLegs(landed);
        setSaved(null);
        setActive(0);
        setCollapsed(false);
        setPicks([]);
        setSaveFailed(false);
      }}
      onCancel={() => {
        setLegs(null);
        globe.current?.setPins([]);
      }}
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
        addedId={saved?.offer ?? undefined}
        savedHref={saved ? `/t/${saved.id}` : undefined}
        error={saveFailed ? "Couldn't save the trip. Please try again." : null}
        home={legs![0]}
        step={{
          index: active,
          count: legs!.length,
          // a return goes with the last leg's card, so stepping back drops it
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
          if (active < legs!.length - 1) {
            // the next leg leaves no earlier than the day after this one
            setLegs(legs!.map((l, i) => (i === active + 1 ? { ...l, departDate: dayAfter(depart) } : l)));
            setActive(active + 1);
            return;
          }
          // a return on the last leg saves as one more leg, back to where the first one left
          const input = soloSaveInput(
            legs!.map((l) => ({ from: stopFromPoint(l.origin, l.from), to: stopFromPoint(l.destination, l.to) })),
            done,
          );
          if (account) return save(input);
          setPendingAction({ type: "save", input });
          openAuth("signup");
        }}
        onDismiss={() => globe.current?.cancel()}
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
