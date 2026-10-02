"use client";

import { useTheme } from "next-themes";
import { useRef, useState } from "react";

import { DEMO_PARTY, EntryPanel } from "@/components/entry";
import { Ticket } from "@/components/paper-atlas";
import { TripGlobe, type LandedTrip, type TripGlobeHandle } from "@/components/trip-globe";
import type { Offer } from "@/lib/transport/types";

import { createTrip } from "./t/actions";

/** "Sat 3 Oct" */
const formatDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
/** "9,624 km" */
const formatDistance = (km: number) => `${km.toLocaleString("en-US")} km`;
const formatMoney = (offer: Offer) =>
  offer.price ? `${offer.price.amount.toLocaleString("en-US", { style: "currency", currency: offer.price.currency })}` : "Typical timetable";

function ResultList({ offers }: { offers: Offer[] }) {
  return (
    <div className="flex max-h-[min(42dvh,360px)] w-[min(92vw,560px)] flex-col gap-(--space-2) overflow-y-auto">
      {offers.map((offer, index) => (
        <a
          key={offer.id}
          href={offer.bookingUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between gap-(--space-4) rounded-(--radius-md) border border-ink/15 bg-paper/95 px-(--space-4) py-(--space-3) text-ink shadow-(--shadow-sm) backdrop-blur transition hover:-translate-y-px"
        >
          <span className="min-w-0">
            <span className="type-label block text-ink-muted">{index === 0 ? "CHEAPEST" : offer.mode.toUpperCase()} · {offer.segments[0].carrier ?? offer.provider}</span>
            <span className="type-body block truncate">{new Date(offer.segments[0].depart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {offer.segments[0].durationMin} min</span>
          </span>
          <span className="type-body shrink-0 text-right">{formatMoney(offer)}</span>
        </a>
      ))}
    </div>
  );
}

export function GlobeScreen() {
  const { resolvedTheme } = useTheme();
  const globe = useRef<TripGlobeHandle>(null);
  const [trip, setTrip] = useState<LandedTrip | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);

  const search = async (nextTrip: LandedTrip) => {
    setTrip(nextTrip);
    setOffers([]);
    setSearchError(false);
    setSearching(true);
    const date = nextTrip.departDate.toISOString().slice(0, 10);
    const params = new URLSearchParams({
      from: JSON.stringify({ name: nextTrip.from.city, lat: nextTrip.from.lat, lng: nextTrip.from.lng, iata: nextTrip.from.code }),
      to: JSON.stringify({ name: nextTrip.to.city, lat: nextTrip.to.lat, lng: nextTrip.to.lng, iata: nextTrip.to.code }),
      date,
      modes: "flight,train,bus,ferry",
      currency: "USD",
      passengers: "1",
    });
    try {
      const response = await fetch(`/api/transport/search?${params}`);
      if (!response.ok) throw new Error("search failed");
      const result = (await response.json()) as { offers: Offer[] };
      setOffers(result.offers);
    } catch {
      setSearchError(true);
    } finally {
      setSearching(false);
    }
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <TripGlobe
        ref={globe}
        theme={resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : "auto"}
        onTakeoff={() => setTrip(null)}
        onLand={search}
        onCancel={() => {
          setTrip(null);
          setOffers([]);
          setSearching(false);
        }}
      />
      <form action={createTrip} className="absolute top-(--space-4) left-(--space-4)">
        <button
          type="submit"
          className="type-tag h-9 rounded-tag border-(length:--line-hair) border-ink bg-paper-raised px-(--space-3) shadow-tag"
        >
          Plan with friends
        </button>
      </form>
      {trip ? (
        <div
          key={`${trip.from.code}-${trip.to.code}-${trip.destination.lat}`}
          className="absolute bottom-(--space-6) left-1/2 flex -translate-x-1/2 flex-col items-center gap-(--space-4) animate-in duration-500 ease-[cubic-bezier(0.2,0.9,0.25,1.15)] fade-in slide-in-from-bottom-[18px] motion-reduce:animate-none"
        >
          <EntryPanel leg={{ fromHub: trip.from.code, toHub: trip.to.code }} members={DEMO_PARTY} />
          <Ticket
            from={{ code: trip.from.code, city: trip.from.city }}
            to={{ code: trip.to.code, city: trip.to.city }}
            date={formatDate(trip.departDate)}
            distance={formatDistance(trip.distanceKm)}
            onClose={() => globe.current?.cancel()}
          />
          {searching ? <p className="type-body text-ink-muted">Finding the cheapest routes…</p> : null}
          {searchError ? <p className="type-body text-ink-muted">Route search failed. Please try again.</p> : null}
          {!searching && !searchError && offers.length > 0 ? <ResultList offers={offers} /> : null}
          {!searching && !searchError && offers.length === 0 ? <p className="type-body text-ink-muted">No supported routes found.</p> : null}
        </div>
      ) : null}
    </main>
  );
}
