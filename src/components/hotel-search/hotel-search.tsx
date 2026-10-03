"use client";

import { useEffect, useState } from "react";

import type { Currency, ExchangeRates } from "@/lib/currency";
import type { HotelFilter, HotelResult } from "@/lib/hotels/types";
import { countries } from "@/lib/nationality";
import { iso2 } from "@/lib/entry/iso";
import { convertCurrency } from "@/lib/currency";

import { hotelQueryKey, resultForHotelQuery, type HotelSearchResult } from "./query";

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

/** Stays at the landed city: live rates when Duffel has them, else estimates. Picking one saves it as the trip's stay there; picking it again unpicks it. */
export function HotelSearch({
  city, lat, lng, checkIn, checkOut, currency, rates, picked, onPick, defaultOccupants = 1,
}: {
  city: string; lat: number; lng: number; checkIn: string; checkOut: string;
  currency: Currency; rates: ExchangeRates | null;
  picked: HotelResult | null; onPick: (hotel: HotelResult | null) => void;
  defaultOccupants?: number;
}) {
  const [filter, setFilter] = useState<HotelFilter>(4);
  const [occupants, setOccupants] = useState(() => Math.min(4, Math.max(1, defaultOccupants)));
  const [guestNationality, setGuestNationality] = useState("");
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
  }, [queryKey]);

  // a pick made for another filter, head count or dates no longer matches what's listed
  const refine = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    onPick(null);
  };

  return (
    <section className="hotel-search" role="tabpanel" aria-label={`Hotels in ${city}`}>
      <div className="hotel-heading">
        <div><h2>Stay in {city}</h2><span>{hotels.some((hotel) => hotel.freshness === "live") ? "Nightly rates" : "Estimated nightly rates"}</span></div>
        <label className="hotel-occupants">Occupants
          <select value={occupants} onChange={(event) => refine(setOccupants)(Number(event.target.value))}>
            {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
      </div>
      <label className="hotel-occupants">Nationality
        <select aria-label="Guest nationality (optional)" value={guestNationality} onChange={(event) => refine(setGuestNationality)(event.target.value)}>
          <option value="">Optional</option>
          {nationalityOptions.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
        </select>
      </label>
      <div className="hotel-filters" role="group" aria-label="Hotel type">
        {filters.map((option) => <button key={String(option.value)} type="button" aria-pressed={filter === option.value} onClick={() => refine(setFilter)(option.value)}>{option.label}</button>)}
      </div>
      <div className="hotel-rows">
        {status === "failed" ? <p className="ts-empty" role="alert">Hotel search failed. Try again.</p> : null}
        {status === "done" && hotels.length === 0 ? <p className="ts-empty">No stays match that filter.</p> : null}
        {hotels.map((hotel) => (
          <button
            type="button"
            className="hotel-row"
            key={hotel.id}
            aria-pressed={picked?.id === hotel.id}
            onClick={() => onPick(picked?.id === hotel.id ? null : hotel)}
          >
            <div>
              <strong>{hotel.name}</strong>
              <span>{hotel.distanceKm.toFixed(1)} km from centre {hotel.freshness !== "live" ? <span className="ts-badge ts-badge-quiet">Estimated</span> : null}</span>
              <span>{hotel.source ?? "Planning estimate"}{hotel.quote ? ` · ${hotel.quote.checkIn} – ${hotel.quote.checkOut} · ${hotel.quote.occupants} adults` : ""}</span>
              {hotel.bookingUrl ? <a className="hotel-book" href={hotel.bookingUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Search Booking.com</a> : <span>Rate subject to confirmation</span>}
            </div>
            <div className="hotel-price"><strong>{formatPrice(hotel.pricePerNight, currency, rates)}</strong><span>per night · {hotel.rooms} {hotel.rooms === 1 ? "room" : "rooms"}</span><small>{formatPrice(hotel.totalPrice, currency, rates)} total · {hotel.freshness === "live" ? "quoted room allocation" : `${hotel.bedsPerRoom} beds/room`}</small></div>
          </button>
        ))}
      </div>
    </section>
  );
}
