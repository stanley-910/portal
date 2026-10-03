"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useEffect, useEffectEvent, useMemo, useRef, useState, useTransition } from "react";

import { HomePip, type HomePipHandle } from "@/components/agent/home-pip";
import { setPendingAction, takePendingAction, useOpenAuth } from "@/components/auth/links";
import { TripLibrary } from "@/components/library/trip-library";
import { NAV_ICONS, NavBar, NavButton, PlaceSearch } from "@/components/nav-bar";
import type { TicketDraft } from "@/components/ticket-search/ticket-search";

import { CurrencySetting } from "@/components/transport/currency-selector";
import { ClickHint, TripGlobe, type LandedTrip, type LatLng, type TripGlobeHandle } from "@/components/trip-globe";
import type { SoloLeg } from "@/lib/agent/solo";
import { CURRENCIES, type ExchangeRates } from "@/lib/currency";
import { setCurrencyPref, useCurrencyPref } from "@/lib/currency-pref";
import { useCursorPref } from "@/lib/cursor-pref";
import { recordTiming } from "@/lib/performance";
import type { Person } from "@/lib/identity";
import { isBookable } from "@/lib/trip/offers";
import { returnLegPick, soloSaveInput, type LegPick } from "@/lib/trip/solo-input";
import { stopFromPoint } from "@/lib/trip/stops";
import { PinTarget, type PinDrop } from "@/components/multiplayer/rider-pins";
import { DeleteTripDialog, LeaveTripDialog } from "@/components/trip-plan/leave-trip";

import { createTrip } from "./t/actions";
import { saveSoloTrip } from "./t/save-actions";
import { useBookAfterSave } from "./use-book-after-save";
import { useLibrary } from "./use-library";

const TicketSearch = dynamic(() => import("@/components/ticket-search/ticket-search").then((m) => m.TicketSearch));
const SoloCheckout = dynamic(() => import("@/components/ticket-search/solo-checkout").then((m) => m.SoloCheckout));

/** A local Date as YYYY-MM-DD. */
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The day after an ISO date, as a local Date: the earliest the next leg can leave. */
function dayAfter(iso: string) {
  const d = new Date(`${iso}T00:00`);
  d.setDate(d.getDate() + 1);
  return d;
}

/** A place to the metre or so, so the same stop reads the same after a trip lands again. */
const placeKey = (ll: LatLng) => `${ll.lat.toFixed(5)},${ll.lng.toFixed(5)}`;

/**
 * Your pin at each stop, keyed by the place (or the pin carried there), so a stop that stays when the trip lands
 * again, rebuilt by Pip or with a stop dragged, keeps its pin standing.
 */
const stopPins = (landed: { destination: LatLng }[], color: number | null, keys: Map<string, string>) =>
  landed.map((leg, i) => {
    const place = placeKey(leg.destination);
    return { key: keys.get(place) ?? `you:${place}`, stop: `stop:${i}`, at: leg.destination, color };
  });

export function GlobeScreen({ person, openTrips = false }: { person: Person | null; openTrips?: boolean }) {
  const { resolvedTheme } = useTheme();
  const globe = useRef<TripGlobeHandle>(null);
  const cursorPref = useCursorPref();
  // the landed trip's legs, the one the popover shows, and what was picked on the legs before it
  const [legs, setLegs] = useState<LandedTrip[] | null>(null);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const [drafts] = useState(() => new Map<number, TicketDraft>());
  const restoring = useRef(false);
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
  // a stop dragged somewhere new keeps its pin: the new place → the key of the pin that was carried there
  const pinKeys = useRef(new Map<string, string>());
  // the way back, once picked, draws home like a saved leg, and your pin drops at home
  const color = cursorPref.color;
  // dates for the legs Pip just put on the globe, or for the trip as it was when a stop is dragged, applied when the
  // globe reports them landed; while set, the trip is being rebuilt and its pins stay
  const pipDates = useRef<string[] | null>(null);
  // My Trips: the library sidebar (accounts only), its trips once loaded, the one picked, and what it draws
  const library = useLibrary(person?.account ?? false, openTrips);
  // leaving or deleting the trip picked in the library, behind its confirm
  const [tripAction, setTripAction] = useState<{ kind: "leave" | "delete"; id: string } | null>(null);
  // `?trips` has done its job once the library is open; drop it so a reload doesn't open it again
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("trips")) return;
    url.searchParams.delete("trips");
    window.history.replaceState(window.history.state, "", url);
  }, []);
  // the library draws only while a trip is picked in it, so letting go hands the globe back the same render
  const showingLibrary = !!library.selected && (library.overlay.flights.length > 0 || library.overlay.pins.length > 0);
  // One owner for the globe's flights and pins: a trip picked in the library while it's out, else the trip being
  // planned here, so the two never draw over each other.
  useEffect(() => {
    const g = globe.current;
    if (!g) return;
    if (showingLibrary) {
      g.setRemoteFlights(library.overlay.flights);
      g.setPins(library.overlay.pins);
      return () => g.setRemoteFlights([]);
    }
    if (!legs) {
      // the library let go with nothing planned here: clear what it drew (a trip Pip is rebuilding keeps its pins)
      if (!pipDates.current) g.setPins([]);
      return;
    }
    const home = legs[0].origin;
    g.setRemoteFlights(goesHome ? [{ id: "you:back", origin: legs.at(-1)!.destination, at: home, ahead: home, landed: true, color }] : []);
    const pins = stopPins(legs, color, pinKeys.current);
    g.setPins(goesHome ? [...pins, { key: "you:back", stop: "stop:home", at: home, color }] : pins);
    return () => g.setRemoteFlights([]);
  }, [legs, goesHome, color, showingLibrary, library.overlay]);
  // Save trip keeps the trip in your account and stays on the globe. Guests sign in first, and the save carries on after.
  const [saving, startSaving] = useTransition();
  const [saveFailed, setSaveFailed] = useState(false);
  const [saved, setSaved] = useState<{ id: string; offer: string | null } | null>(null);
  /** Moves stop `i` (where leg `i` ends) to where its pin was dropped: the trip lands again there, keeping its dates. */
  const moveStop = (i: number, place: PinDrop): string | null => {
    if (!legs) return "The trip has gone.";
    const points = [legs[0].origin, ...legs.map((l) => l.destination)];
    const was = points[i + 1];
    points[i + 1] = place.at;
    pinKeys.current.set(placeKey(place.at), pinKeys.current.get(placeKey(was)) ?? `you:${placeKey(was)}`);
    pipDates.current = soloTrip.slice(0, legs.length).map((l) => l.date);
    globe.current?.showTrip(points, "quiet");
    return null;
  };
  const pip = useRef<HomePipHandle>(null);
  const currency = useCurrencyPref();
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  const [rateError, setRateError] = useState(false);

  const account = person?.account ?? false;
  const openAuth = useOpenAuth();
  // Book saves like Save trip, then checks out the saved trip's leg right in the fare card
  const book = useBookAfterSave(account);
  const runSave = (input: Parameters<typeof saveSoloTrip>[0]) =>
    startSaving(async () => {
      const started = performance.now();
      const result = await saveSoloTrip(input).catch(() => ({ error: "failed" as const }));
      if ("error" in result) {
        book.cancel();
        return setSaveFailed(true);
      }
      const legs = (input as { legs?: { chosen?: string | null }[] }).legs;
      // No refresh: nothing on the globe screen shows saved trips, and /trips is dynamic, so it reads them fresh when
      // opened. A refresh here re-rendered the whole screen and held the button on "Saving" for another round trip.
      recordTiming("save", started);
      setSaved({ id: result.id, offer: legs?.at(-1)?.chosen ?? null });
      if (book.after(result, input)) return;
    });
  const save = (input: Parameters<typeof saveSoloTrip>[0]) => {
    setSaveFailed(false);
    runSave(input);
  };

  const resumeSave = useEffectEvent((input: Parameters<typeof saveSoloTrip>[0]) => runSave(input));

  // back from signing in: finish what sent them there
  useEffect(() => {
    if (!account) return;
    const pending = takePendingAction();
    if (pending?.type === "save") {
      void import("@/lib/trip/restore-solo").then(({ restoreSolo }) => {
        const restored = restoreSolo(pending.input);
        if (!restored) { setSaveFailed(true); return; }
        restoring.current = true;
        pipDates.current = restored.picks.map((p) => p.depart);
        setLegs(restored.legs);
        setPicks(restored.picks);
        setActive(restored.legs.length - 1);
        globe.current?.showTrip([restored.legs[0].origin, ...restored.legs.map((l) => l.destination)], "quiet");
        resumeSave(restored.input);
      }).catch(() => setSaveFailed(true));
    }
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
      searching={searching}
      color={cursorPref.color}
      cursorShape={cursorPref.shape}
      theme={resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : "auto"}
      onTakeoff={() => {
        if (!restoring.current) setLegs(null);
        setSearching(false);
        // planning a new trip lets go of the one picked in the library
        library.select(null);
        // Pip rebuilding the trip keeps the pins it doesn't move
        if (!pipDates.current) globe.current?.setPins([]);
      }}
      onLand={(flown) => {
        library.select(null);
        // a trip Pip planned lands like a flown one, then takes Pip's dates
        const dates = pipDates.current;
        pipDates.current = null;
        const landed = dates ? flown.map((l, i) => (dates[i] ? { ...l, departDate: new Date(`${dates[i]}T00:00`) } : l)) : flown;
        // your pin drops at each stop once your plane has landed and gone
        globe.current?.setPins(stopPins(landed, cursorPref.color, pinKeys.current));
        setLegs(landed);
        if (restoring.current) { restoring.current = false; return; }
        drafts.clear();
        setSaved(null);
        book.close();
        setActive(0);
        setCollapsed(false);
        setPicks([]);
        setSaveFailed(false);
      }}
      onCancel={() => {
        setLegs(null);
        if (!pipDates.current) globe.current?.setPins([]);
      }}
      onRouteClick={() => setCollapsed(false)}
    />
    {legs ? (
      // your pin at each stop: pointed at, it says so; clicked, it opens the trip; dragged, it moves the stop
      <div className="pointer-events-none absolute inset-0 isolate overflow-hidden">
        {legs.map((_, i) => (
          <PinTarget
            key={`stop:${i}`}
            globe={globe}
            stop={{ id: `stop:${i}`, name: soloTrip[i]?.to.name ?? "this stop" }}
            who="You"
            onOpen={() => setCollapsed(false)}
            onMove={(place) => moveStop(i, place)}
          />
        ))}
      </div>
    ) : null}
    <NavBar
      globe={globe}
      name={person?.name ?? null}
      email={person?.email ?? null}
      account={person?.account ?? false}
      nationalities={person?.nationalities}
      color={person?.color}
      onTrips={() => library.setOpen(true)}
      settings={<CurrencySetting currency={currency} rates={rates} error={rateError} onChange={setCurrencyPref} />}
    >
      <PlaceSearch
        globe={globe}
        onRoute={(from, to, date) => {
          // the route draws out to the two places and lands on the picked date, like a trip Pip planned
          pipDates.current = [date];
          globe.current?.showTrip([from, to], "draw");
        }}
      />
      {account ? (
        <NavButton icon={NAV_ICONS.trips} label="Trips" aria-expanded={library.open} onClick={() => library.setOpen(!library.open)} />
      ) : null}
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
        initialDraft={drafts.get(active)}
        initialPick={picks[active]}
        onDraft={(draft) => drafts.set(active, draft)}
        onSearchingChange={setSearching}
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
            setLegs(legs!.map((l, i) => {
              if (i !== active + 1 || isoDay(l.departDate) > depart) return l;
              drafts.delete(i);
              return { ...l, departDate: dayAfter(depart) };
            }));
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
        onBook={book.request}
        checkout={
          book.checkout ? (
            <SoloCheckout
              key={`${book.checkout.tripId}:${book.checkout.legId}`}
              tripId={book.checkout.tripId}
              legId={book.checkout.legId}
              email={person?.email ?? null}
              nationalities={person?.nationalities ?? []}
              onClose={book.close}
            />
          ) : undefined
        }
        canBook={picks.slice(0, active).some((p) => !!p.offer && isBookable(p.offer))}
        onDismiss={() => globe.current?.cancel()}
        collapsed={collapsed}
        onCollapse={() => setCollapsed(true)}
        onExpand={() => setCollapsed(false)}
        riders={[{ id: "you", name: "You", passport: person?.nationalities?.[0] ?? null, passports: person?.nationalities?.slice(1), onwardCountry: legs?.[active + 1]?.to?.country ?? null }]}
      />
    ) : null}
    {account ? (
      <TripLibrary
        trips={library.trips}
        error={library.error}
        userId={library.userId ?? person?.id ?? ""}
        today={isoDay(new Date())}
        open={library.open}
        onOpenChange={library.setOpen}
        selected={library.selected}
        onSelect={library.select}
        onRename={library.rename}
        hrefFor={(id) => `/t/${id}`}
        onLeave={(id) => setTripAction({ kind: "leave", id })}
        onDelete={(id) => setTripAction({ kind: "delete", id })}
        currency={currency}
        rates={rates}
        draw={library.setOverlay}
        globe={globe}
      />
    ) : null}
    {tripAction?.kind === "leave" ? (
      <LeaveTripDialog tripId={tripAction.id} next={() => {
        library.remove(tripAction.id);
        setTripAction(null);
      }} onClose={() => setTripAction(null)} />
    ) : tripAction?.kind === "delete" ? (
      <DeleteTripDialog tripId={tripAction.id} next={() => {
        library.remove(tripAction.id);
        setTripAction(null);
      }} onClose={() => setTripAction(null)} />
    ) : null}
    {!trip && saveFailed ? <p role="alert" className="type-body absolute bottom-(--space-6) left-1/2 -translate-x-1/2 bg-paper-raised p-(--space-3)">Couldn&apos;t restore the trip. Please select the route again.</p> : null}
    {/* how to draw a trip, in the bottom-left corner */}
    <ClickHint color={cursorPref.color} />
    <HomePip
      globe={globe}
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
