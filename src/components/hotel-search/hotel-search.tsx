"use client";

import { useEffect, useState } from "react";

import { Select } from "@/components/paper-atlas";
import { dateLabel } from "@/components/ticket-search/parts";
import { convertCurrency, type Currency, type ExchangeRates } from "@/lib/currency";
import type { HotelFilter, HotelResult } from "@/lib/hotels/types";
import { countries } from "@/lib/nationality";
import { iso2 } from "@/lib/entry/iso";

import { hotelQueryKey, resultForHotelQuery, type HotelSearchResult } from "./query";

// Built from the ticket card's parts (ticket-search.css) so it reads as one more section of the same card: a caption
// line, two small fields, the underline tabs, and option rows.

const GUEST_OPTIONS = [1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }));
const nationalityOptions = countries().flatMap((country) => {
  const code = iso2(country.code);
  return code ? [{ code, name: country.name }] : [];
});

const filters: Array<{ value: HotelFilter; label: string }> = [
  { value: 2, label: "2★" }, { value: 3, label: "3★" }, { value: 4, label: "4★" },
  { value: 5, label: "5★" }, { value: "hostel", label: "Hostel" },
];

const formatPrice = (price: { amount: number; currency: string }, currency: Currency, rates: ExchangeRates | null) => {
  const converted = price.currency === currency ? price.amount : rates ? convertCurrency(price.amount, price.currency, currency, rates) : null;
  return converted === null ? "—" : new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(converted);
};

const nightCount = (checkIn: string, checkOut: string) => Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);

/**
 * Stays at the landed city: live rates when Duffel has them, else estimates. Picking one hands it to `onPick`; picking
 * it again unpicks it. `tabPanel` when it is the content of a tab, as in the ticket search.
 */
export function HotelSearch({
  city, lat, lng, checkIn, checkOut, currency, rates, picked, onPick, defaultOccupants = 1, tabPanel = false,
}: {
  city: string; lat: number; lng: number; checkIn: string; checkOut: string;
  currency: Currency; rates: ExchangeRates | null;
  picked: HotelResult | null; onPick: (hotel: HotelResult | null) => void;
  defaultOccupants?: number;
  tabPanel?: boolean;
}) {
  const [filter, setFilter] = useState<HotelFilter>(4);
  const [occupants, setOccupants] = useState(() => Math.min(4, Math.max(1, defaultOccupants)));
  const [guestNationality, setGuestNationality] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<HotelSearchResult | null>(null);
  const queryKey = hotelQueryKey({ city, lat, lng, checkIn, checkOut, occupants, filter, guestNationality });
  const { hotels, status } = resultForHotelQuery(queryKey, result);

  useEffect(() => {
    if (!queryKey) return;
    const controller = new AbortController();
    fetch(`/api/hotels/search?${queryKey}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("hotel search failed");
        const data = await response.json() as { hotels: HotelResult[] };
        if (controller.signal.aborted) return;
        setResult({ queryKey, hotels: data.hotels, status: "done" });
      })
      .catch(() => { if (!controller.signal.aborted) setResult({ queryKey, hotels: [], status: "failed" }); });
    return () => controller.abort();
  }, [queryKey, attempt]);

  // a pick made for another filter, head count or dates no longer matches what's listed
  const refine = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    onPick(null);
  };
  const nights = nightCount(checkIn, checkOut);

  return (
    <section className="hs" role={tabPanel ? "tabpanel" : undefined} aria-label={`Stays in ${city}`}>
      <p className="ts-step hs-caption">
        Stays in {city} · {dateLabel(checkIn)} to {dateLabel(checkOut)}, {nights} night{nights === 1 ? "" : "s"}
      </p>
      <div className="hs-fields">
        <Select
          className="hs-field"
          label="Guests"
          value={String(occupants)}
          options={GUEST_OPTIONS}
          onChange={(v) => refine(setOccupants)(Number(v))}
        />
        <Select
          className="hs-field"
          label="Nationality"
          value={guestNationality}
          placeholder="Any"
          searchable
          options={[{ value: "", label: "Any" }, ...nationalityOptions.map((c) => ({ value: c.code, label: c.name }))]}
          onChange={(v) => refine(setGuestNationality)(v)}
        />
      </div>
      <div className="ts-tabs" role="tablist" aria-label="Hotel type">
        {filters.map((option) => (
          <button key={String(option.value)} type="button" role="tab" className="ts-tab" aria-selected={filter === option.value} onClick={() => refine(setFilter)(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
      <div className="ts-rows hs-rows">
        {status === "searching" ? [0, 1].map((i) => (
          <div key={i} className="ts-row ts-row-ghost" aria-hidden>
            <span className="ts-ghost ts-ghost-head" />
            <span className="ts-ghost ts-ghost-price" />
            <span className="ts-ghost ts-ghost-desc" />
          </div>
        )) : null}
        {status === "failed" ? <p className="ts-empty" role="alert">Hotel search failed. <button type="button" className="ts-oneway" onClick={() => { setResult(null); setAttempt((n) => n + 1); }}>Try again</button></p> : null}
        {status === "done" && hotels.length === 0 ? <p className="ts-empty">No stays match that filter.</p> : null}
        {hotels.map((hotel) => {
          const isPicked = picked?.id === hotel.id;
          return (
            <div key={hotel.id} className="hs-option">
              <button type="button" className="ts-row hs-row" aria-pressed={isPicked} onClick={() => onPick(isPicked ? null : hotel)}>
                {hotel.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- provider photos, not ours to optimise
                  <img className="hs-photo" src={hotel.photoUrl} alt="" loading="lazy" />
                ) : null}
                <span className="ts-head">
                  <span className="hs-name">{hotel.name}</span>
                  {isPicked ? <span className="ts-badge">Picked</span> : null}
                  {hotel.freshness !== "live" ? <span className="ts-badge ts-badge-quiet">Estimated</span> : null}
                </span>
                <span className="ts-price">{formatPrice(hotel.pricePerNight, currency, rates)}</span>
                <span className="ts-desc">
                  {hotel.distanceKm.toFixed(1)} km from centre · {hotel.rooms} room{hotel.rooms === 1 ? "" : "s"} · {formatPrice(hotel.totalPrice, currency, rates)} total · {hotel.source ?? "Planning estimate"}
                </span>
              </button>
              {hotel.bookingUrl ? (
                <a className="ts-oneway hs-book" href={hotel.bookingUrl} target="_blank" rel="noreferrer">
                  Booking.com
                </a>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
