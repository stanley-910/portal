"use client";

import { useTheme } from "next-themes";
import { useRef, useState } from "react";

import { DEMO_PARTY, EntryPanel } from "@/components/entry";
import { NAV_ICONS, NavBar, NavButton } from "@/components/nav-bar";
import { Ticket } from "@/components/paper-atlas";
import { TripGlobe, type LandedTrip, type TripGlobeHandle } from "@/components/trip-globe";
import type { Offer } from "@/lib/transport/types";

import { createTrip } from "./t/actions";

/** "Sat 3 Oct" */
const formatDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const dateFromIso = (value: string) => new Date(`${value}T00:00:00Z`);
/** "9,624 km" */
const formatDistance = (km: number) => `${km.toLocaleString("en-US")} km`;
const formatMoney = (offer: Offer) =>
  offer.price ? `${offer.price.amount.toLocaleString("en-US", { style: "currency", currency: offer.price.currency })}` : "Typical timetable";

function bestByMode(offers: Offer[]): Offer[] {
  const seen = new Set<Offer["mode"]>();
  return offers.filter((offer) => {
    if (seen.has(offer.mode)) return false;
    seen.add(offer.mode);
    return true;
  });
}

function ResultCard({ offer, best }: { offer: Offer; best?: boolean }) {
  return (
    <a
      href={offer.bookingUrl}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-11 items-center justify-between gap-(--space-4) rounded-tag border border-ink bg-paper-raised px-(--space-4) py-(--space-3) text-ink shadow-tag transition hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-(--focus)"
    >
      <span className="min-w-0">
        <span className="type-label block text-ink-muted">
          {best ? "BEST" : offer.mode.toUpperCase()} · {offer.segments[0].carrier ?? offer.provider}
        </span>
        <span className="type-body block truncate">
          {new Date(offer.segments[0].depart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {offer.segments[0].durationMin} min
        </span>
      </span>
      <span className="type-body shrink-0 text-right">{formatMoney(offer)}</span>
    </a>
  );
}

function ResultList({ offers, showOtherOptions, onToggle }: { offers: Offer[]; showOtherOptions: boolean; onToggle: () => void }) {
  const options = bestByMode(offers);
  const primary = options[0];
  const otherOptions = options.slice(1);

  return (
    <div className="flex max-h-[min(42dvh,360px)] w-[min(92vw,560px)] flex-col gap-(--space-2) overflow-y-auto">
      {primary ? <ResultCard offer={primary} best /> : null}
      {otherOptions.length > 0 ? (
        <button
          type="button"
          className="type-tag min-h-11 rounded-tag border border-ink bg-paper-raised px-(--space-4) text-ink shadow-tag focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-(--focus)"
          aria-expanded={showOtherOptions}
          onClick={onToggle}
        >
          {showOtherOptions ? "Hide other options" : `Other options (${otherOptions.length})`}
        </button>
      ) : null}
      {showOtherOptions ? otherOptions.map((offer) => <ResultCard key={offer.id} offer={offer} />) : null}
    </div>
  );
}

function DatePicker({
  value,
  min,
  onChange,
}: {
  value: string;
  min: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed right-(--space-4) bottom-(--space-4) z-10 flex flex-col items-end gap-(--space-2)">
      {open ? (
        <div className="rounded-ticket border border-ink bg-paper-raised p-(--space-3) shadow-ticket">
          <label className="flex flex-col gap-(--space-2)">
            <span className="type-tag text-ink">Departure date</span>
            <input
              type="date"
              value={value}
              min={min}
              onChange={(event) => {
                if (event.target.value) onChange(event.target.value);
              }}
              className="type-stamp min-h-11 rounded-tag border border-ink bg-paper px-(--space-2) text-ink focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-(--focus)"
            />
          </label>
        </div>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? "Close departure date picker" : "Choose departure date"}
        onClick={() => setOpen((visible) => !visible)}
        className="pa-round type-stamp px-2"
      >
        <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
          <rect x="2" y="3.5" width="12" height="10" rx="1" />
          <path d="M5 2v3M11 2v3M2 6.5h12" />
        </svg>
        <span className="sr-only">{value}</span>
      </button>
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
  const [showOtherOptions, setShowOtherOptions] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const search = async (nextTrip: LandedTrip, selectedDateValue = isoDate(nextTrip.departDate)) => {
    setTrip({ ...nextTrip, departDate: dateFromIso(selectedDateValue) });
    setSelectedDate(selectedDateValue);
    setOffers([]);
    setSearchError(false);
    setShowOtherOptions(false);
    setSearching(true);
    const date = selectedDateValue;
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
          setSelectedDate(null);
          setOffers([]);
          setSearching(false);
          setShowOtherOptions(false);
        }}
      />
      <NavBar globe={globe}>
        <form action={createTrip}>
          <NavButton type="submit" icon={NAV_ICONS.friends} label="Plan with friends" />
        </form>
      </NavBar>
      {trip ? (
        <div
          key={`${trip.from.code}-${trip.to.code}-${trip.destination.lat}`}
          className="absolute bottom-(--space-6) left-1/2 flex -translate-x-1/2 flex-col items-center gap-(--space-4) animate-in duration-500 ease-[cubic-bezier(0.2,0.9,0.25,1.15)] fade-in slide-in-from-bottom-[18px] motion-reduce:animate-none"
        >
          <EntryPanel leg={{ fromHub: trip.from.code, toHub: trip.to.code }} members={DEMO_PARTY} />
          {searching ? <p className="type-body text-ink-muted">Comparing routes…</p> : null}
          {searchError ? <p className="type-body text-ink-muted">Route search failed. Please try again.</p> : null}
          {!searching && !searchError && offers.length > 0 ? (
            <ResultList
              offers={offers}
              showOtherOptions={showOtherOptions}
              onToggle={() => setShowOtherOptions((visible) => !visible)}
            />
          ) : null}
          {!searching && !searchError && offers.length === 0 ? <p className="type-body text-ink-muted">No supported routes found.</p> : null}
          <Ticket
            from={{ code: trip.from.code, city: trip.from.city }}
            to={{ code: trip.to.code, city: trip.to.city }}
            date={formatDate(trip.departDate)}
            distance={formatDistance(trip.distanceKm)}
            onClose={() => globe.current?.cancel()}
          />
        </div>
      ) : null}
      {trip && selectedDate ? (
        <DatePicker
          value={selectedDate}
          min={isoDate(new Date())}
          onChange={(date) => void search(trip, date)}
        />
      ) : null}
    </main>
  );
}
