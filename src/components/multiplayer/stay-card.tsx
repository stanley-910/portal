"use client";

import { formatMoney, inCurrency, type Currency, type ExchangeRates } from "@/lib/currency";
import { memberColor, type TripMember } from "@/lib/liveblocks/types";
import type { NewStay } from "@/lib/trip/plan";
import type { PlanStay } from "@/lib/trip/split";

// One stay in the plan: where some of the group sleep, with its own nights and guests, apart from the legs. Riding a
// leg never makes anyone a guest, so dropping off a flight leaves the hotel as it was, and the other way round.

const nights = (checkIn: string, checkOut: string) => Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);

export function StayCard({
  stay,
  members,
  currency,
  rates,
  onChange,
  onRemove,
}: {
  stay: PlanStay;
  members: Readonly<Record<string, Pick<TripMember, "name" | "color">>> | null;
  currency: Currency;
  rates: ExchangeRates | null;
  onChange: (patch: Partial<NewStay>) => void;
  onRemove: () => void;
}) {
  const n = nights(stay.checkIn, stay.checkOut);
  const setDate = (field: "checkIn" | "checkOut", value: string) => {
    const next = { checkIn: stay.checkIn, checkOut: stay.checkOut, [field]: value };
    // a range that ends before it starts waits for the other date
    if (value && next.checkOut > next.checkIn) onChange({ [field]: value });
  };
  return (
    <div className="tp-stay-card">
      <div className="tp-stay-head">
        <span className="ts-head">
          <span className="hs-name">{stay.label ?? "Stay"}</span>
          {stay.estimated ? <span className="ts-badge ts-badge-quiet">Estimated</span> : null}
        </span>
        <span className="ts-price" data-none={!stay.nightly || undefined}>
          {stay.nightly ? `${formatMoney(inCurrency(stay.nightly, currency, rates))} a night` : "No price"}
        </span>
      </div>
      <div className="ts-dates tp-stay-dates">
        <label className="ts-field hs-field">
          <span className="ts-field-label">Check in</span>
          <input type="date" className="ts-field-value" value={stay.checkIn} max={stay.checkOut} onChange={(e) => setDate("checkIn", e.target.value)} />
        </label>
        <label className="ts-field hs-field">
          <span className="ts-field-label">
            Check out, {n} night{n === 1 ? "" : "s"}
          </span>
          <input type="date" className="ts-field-value" value={stay.checkOut} min={stay.checkIn} onChange={(e) => setDate("checkOut", e.target.value)} />
        </label>
      </div>
      <div className="tp-edit-row">
        <ul className="tp-rider-list" aria-label="Guests">
          {members
            ? Object.entries(members).map(([id, info]) => (
                <li key={id}>
                  <button
                    type="button"
                    className="tp-rider"
                    aria-pressed={stay.guests.includes(id)}
                    title={info.name}
                    onClick={() => onChange({ guests: stay.guests.includes(id) ? stay.guests.filter((g) => g !== id) : [...stay.guests, id] })}
                    style={{ borderColor: memberColor(info.color) }}
                  >
                    {info.name.slice(0, 1).toUpperCase()}
                  </button>
                </li>
              ))
            : null}
        </ul>
        <button type="button" className="ts-oneway tp-remove" onClick={onRemove}>
          Remove stay
        </button>
      </div>
    </div>
  );
}
