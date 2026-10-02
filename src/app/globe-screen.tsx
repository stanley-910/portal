"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import { DEMO_PARTY, EntryPanel } from "@/components/entry";
import { Ticket } from "@/components/paper-atlas";
import { NAV_ICONS, NavBar, NavButton } from "@/components/nav-bar";
import { DatePicker } from "@/components/transport/date-picker";
import { TransportResults } from "@/components/transport/results";
import { TripGlobe, type LandedTrip, type TripGlobeHandle } from "@/components/trip-globe";
import { clickSearchParams, localDate } from "@/lib/transport/client-query";
import { distanceKm } from "@/lib/transport/hubs/geo";
import type { HubSearchResult } from "@/lib/transport/hub-search";

import { createTrip } from "./t/actions";

const formatDate = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
const coordinates = (point: { lat: number; lng: number }) => `${point.lat.toFixed(2)}, ${point.lng.toFixed(2)}`;

export function GlobeScreen() {
  const { resolvedTheme } = useTheme();
  const globe = useRef<TripGlobeHandle>(null);
  const pending = useRef<AbortController | null>(null);
  const [trip, setTrip] = useState<LandedTrip | null>(null);
  const [result, setResult] = useState<HubSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);

  useEffect(() => () => { pending.current?.abort(); }, []);

  const clear = () => {
    pending.current?.abort();
    pending.current = null;
    setTrip(null);
    setResult(null);
    setSearching(false);
    setSearchError(false);
  };
  const search = async (nextTrip: LandedTrip, date = localDate(nextTrip.departDate)) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    // Noon in the browser's local timezone preserves the selected calendar day.
    const datedTrip = { ...nextTrip, departDate: new Date(`${date}T12:00:00`) };
    setTrip(datedTrip);
    setResult(null);
    setSearchError(false);
    setSearching(true);
    try {
      const response = await fetch(`/api/transport/search?${clickSearchParams(datedTrip)}`, { signal: controller.signal });
      if (!response.ok) throw new Error("Search failed");
      const next = await response.json() as HubSearchResult;
      if (pending.current === controller && !controller.signal.aborted) setResult(next);
    } catch {
      if (pending.current === controller && !controller.signal.aborted) setSearchError(true);
    } finally {
      if (pending.current === controller && !controller.signal.aborted) setSearching(false);
    }
  };
  // Show provider endpoints when available, otherwise the first geographic pair.
  // A local hover preview is not a connection-aware search result.
  const firstOfferPair = result?.offers[0] && result.offerPairs[result.offers[0].id]?.[0];
  const preferredPair = result?.hubs.pairs.find((pair) => pair.id === firstOfferPair) ?? result?.hubs.pairs[0];
  const primary = result?.offers[0];
  const from = primary?.segments[0].from ?? preferredPair?.from.hub;
  const to = primary?.segments.at(-1)?.to ?? preferredPair?.to.hub;
  const mode = primary?.mode ?? preferredPair?.mode;
  const originLabel = (firstOfferPair || !primary) ? preferredPair?.from.hub.city || from?.name : from?.name;
  const destinationLabel = (firstOfferPair || !primary) ? preferredPair?.to.hub.city || to?.name : to?.name;
  const code = (iata?: string) => iata ?? (mode === "train" ? "RAIL" : mode === "ferry" ? "PORT" : mode === "bus" ? "BUS" : "—");

  return <main className="relative h-dvh w-full overflow-hidden">
    <TripGlobe
      ref={globe}
      theme={resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : "auto"}
      onTakeoff={clear}
      onLand={search}
      onCancel={clear}
    />
    <NavBar globe={globe}>
      <form action={createTrip}>
        <NavButton type="submit" icon={NAV_ICONS.friends} label="Plan with friends" />
      </form>
    </NavBar>
    {trip ? <div className="absolute bottom-(--space-6) left-1/2 flex max-h-[90dvh] -translate-x-1/2 flex-col items-center gap-(--space-3) overflow-y-auto p-(--space-6)">
      {from?.iata && to?.iata ? <EntryPanel leg={{ fromHub: from.iata, toHub: to.iata }} members={DEMO_PARTY} /> : null}
      <Ticket
        className="shrink-0"
        from={{ code: code(from?.iata), city: originLabel || coordinates(trip.origin) }}
        to={{ code: code(to?.iata), city: destinationLabel || coordinates(trip.destination) }}
        date={formatDate(trip.departDate)}
        searching={searching}
        distance={from && to ? `${Math.round(distanceKm(from, to)).toLocaleString("en-US")} km` : "—"}
        onClose={() => globe.current?.cancel()}
      />
      <div role="status" aria-live="polite">
        {searching ? <p className="type-body rounded-tag bg-paper-raised p-(--space-3) text-ink-muted">Finding hubs and routes…</p> : null}
        {searchError ? <p className="type-body rounded-tag bg-paper-raised p-(--space-3) text-ink-muted">Route search failed. Please try again.</p> : null}
      </div>
      {result ? <TransportResults result={result} /> : null}
    </div> : null}
    {trip ? <DatePicker value={localDate(trip.departDate)} min={localDate(new Date())}
      onChange={(date) => void search(trip, date)} /> : null}
  </main>;
}
