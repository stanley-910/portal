"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import { HomePip } from "@/components/agent/home-pip";
import { NAV_ICONS, NavBar, NavButton, PlaceSearch } from "@/components/nav-bar";
import { TicketSearch } from "@/components/ticket-search";
import { CurrencySetting } from "@/components/transport/currency-selector";
import { TripGlobe, type LandedTrip, type TripGlobeHandle } from "@/components/trip-globe";
import { CURRENCIES, type Currency, type ExchangeRates } from "@/lib/currency";

import { createTrip } from "./t/actions";

export function GlobeScreen({ guestName }: { guestName: string | null }) {
  const { resolvedTheme } = useTheme();
  const globe = useRef<TripGlobeHandle>(null);
  const [trip, setTrip] = useState<LandedTrip | null>(null);
  // the option added from the popover; there is no trip storage on this screen, so it only marks the button done
  const [addedId, setAddedId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>("USD");
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  const [rateError, setRateError] = useState(false);

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
        setAddedId(null);
      }}
      onCancel={() => setTrip(null)}
    />
    <NavBar
      globe={globe}
      guestName={guestName}
      settings={<CurrencySetting currency={currency} rates={rates} error={rateError} onChange={setCurrency} />}
    >
      <PlaceSearch globe={globe} />
      <form action={createTrip}>
        <NavButton type="submit" icon={NAV_ICONS.friends} label="Plan with friends" />
      </form>
    </NavBar>
    {trip ? (
      <TicketSearch
        key={`${trip.origin.lat},${trip.origin.lng}-${trip.destination.lat},${trip.destination.lng}`}
        trip={trip}
        globe={globe}
        currency={currency}
        rates={rates}
        addedId={addedId}
        onAdd={({ offer }) => setAddedId(offer.id)}
        onDismiss={() => globe.current?.cancel()}
      />
    ) : null}
    <HomePip />
  </main>;
}

