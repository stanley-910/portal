"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState, useTransition } from "react";

import { HomePip, startTrip } from "@/components/agent/home-pip";
import { setPendingAction, takePendingAction, useOpenAuth } from "@/components/auth/links";
import { NAV_ICONS, NavBar, NavButton, PlaceSearch } from "@/components/nav-bar";
import { MyTrips } from "@/components/trip-plan/my-trips";
import { TicketSearch } from "@/components/ticket-search";
import { CurrencySetting } from "@/components/transport/currency-selector";
import { TripGlobe, type LandedTrip, type TripGlobeHandle } from "@/components/trip-globe";
import { CURRENCIES, type Currency, type ExchangeRates } from "@/lib/currency";
import type { Person } from "@/lib/identity";
import type { Offer } from "@/lib/transport/types";
import { MAX_OFFERS } from "@/lib/trip/offers";
import type { TripSummary } from "@/lib/trip/server";
import { stopFromPoint } from "@/lib/trip/stops";

import { createTrip } from "./t/actions";
import { saveSoloTrip } from "./t/save-actions";

/** The options saved with the leg: the search's own order, cut to what a room keeps, always including the pick. */
function savedOptions(offer: Offer, offers: Offer[]): Offer[] {
  const kept = offers.slice(0, MAX_OFFERS);
  if (!kept.some((o) => o.id === offer.id)) kept[kept.length ? kept.length - 1 : 0] = offer;
  return kept;
}

export function GlobeScreen({ person, trips = [] }: { person: Person | null; trips?: TripSummary[] }) {
  const { resolvedTheme } = useTheme();
  const globe = useRef<TripGlobeHandle>(null);
  const [trip, setTrip] = useState<LandedTrip | null>(null);
  // Save trip makes a new trip room and opens it. Guests sign in first, and the save carries on after.
  const [saving, startSaving] = useTransition();
  const [saveFailed, setSaveFailed] = useState(false);
  const [currency, setCurrency] = useState<Currency>("USD");
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
      theme={resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : "auto"}
      onTakeoff={() => setTrip(null)}
      onLand={(landed) => {
        setTrip(landed);
        setSaveFailed(false);
      }}
      onCancel={() => setTrip(null)}
    />
    <NavBar
      globe={globe}
      name={person?.name ?? null}
      email={person?.email ?? null}
      account={person?.account ?? false}
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
    <div className="absolute top-20 left-(--space-4) z-[5]">
      <MyTrips trips={trips} />
    </div>
    {trip ? (
      <TicketSearch
        key={`${trip.origin.lat},${trip.origin.lng}-${trip.destination.lat},${trip.destination.lng}`}
        trip={trip}
        globe={globe}
        currency={currency}
        rates={rates}
        saving={saving}
        error={saveFailed ? "Couldn't save the trip. Please try again." : null}
        onAdd={({ offer, offers, depart }) => {
          const input = {
            from: stopFromPoint(trip.origin, trip.from),
            to: stopFromPoint(trip.destination, trip.to),
            date: depart,
            offers: savedOptions(offer, offers),
            chosen: offer.id,
          };
          if (account) return save(input);
          setPendingAction({ type: "save", input });
          openAuth("signup");
        }}
        onDismiss={() => globe.current?.cancel()}
      />
    ) : null}
    <HomePip account={account} />
  </main>;
}

