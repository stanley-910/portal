"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import { DEMO_PARTY, EntryPanel } from "@/components/entry";
import { Ticket } from "@/components/paper-atlas";
import { TransportResults } from "@/components/transport/results";
import { TripGlobe, type LandedTrip, type TripGlobeHandle } from "@/components/trip-globe";
import { clickSearchParams } from "@/lib/transport/client-query";
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
  const search = async (nextTrip: LandedTrip) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setTrip(nextTrip);
    setResult(null);
    setSearchError(false);
    setSearching(true);
    try {
      const response = await fetch(`/api/transport/search?${clickSearchParams(nextTrip)}`, { signal: controller.signal });
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
  // Never present the globe renderer's legacy mock snap as a search result.
  const firstOfferPair = result?.offers[0] && result.offerPairs[result.offers[0].id]?.[0];
  const preferredPair = result?.hubs.pairs.find((pair) => pair.id === firstOfferPair) ?? result?.hubs.pairs[0];

  return <main className="relative h-dvh w-full overflow-hidden">
    <TripGlobe
      ref={globe}
      theme={resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : "auto"}
      onTakeoff={clear}
      onLand={search}
      onCancel={clear}
    />
    <form action={createTrip} className="absolute top-(--space-4) left-(--space-4)">
      <button type="submit" className="type-tag min-h-11 rounded-tag border-(length:--line-hair) border-ink bg-paper-raised px-(--space-3) shadow-tag">New trip</button>
    </form>
    {trip ? <div className="absolute bottom-(--space-6) left-1/2 flex max-h-[90dvh] -translate-x-1/2 flex-col items-center gap-(--space-3) overflow-y-auto p-(--space-6)">
      {preferredPair?.mode === "flight" ? <EntryPanel leg={{ fromHub: preferredPair.from.hub.code, toHub: preferredPair.to.hub.code }} members={DEMO_PARTY} /> : null}
      <Ticket
        className="shrink-0"
        from={{ code: preferredPair ? (preferredPair.mode === "flight" ? preferredPair.from.hub.code : preferredPair.mode === "train" ? "RAIL" : "PORT") : "—", city: preferredPair?.from.hub.city || preferredPair?.from.hub.name || coordinates(trip.origin) }}
        to={{ code: preferredPair ? (preferredPair.mode === "flight" ? preferredPair.to.hub.code : preferredPair.mode === "train" ? "RAIL" : "PORT") : "—", city: preferredPair?.to.hub.city || preferredPair?.to.hub.name || coordinates(trip.destination) }}
        date={formatDate(trip.departDate)}
        searching={searching}
        distance={preferredPair ? `${Math.round(preferredPair.distanceKm).toLocaleString("en-US")} km` : "—"}
        onClose={() => globe.current?.cancel()}
      />
      <div role="status" aria-live="polite">
        {searching ? <p className="type-body rounded-tag bg-paper-raised p-(--space-3) text-ink-muted">Finding hubs and routes…</p> : null}
        {searchError ? <p className="type-body rounded-tag bg-paper-raised p-(--space-3) text-ink-muted">Route search failed. Please try again.</p> : null}
      </div>
      {result ? <TransportResults result={result} /> : null}
    </div> : null}
  </main>;
}
