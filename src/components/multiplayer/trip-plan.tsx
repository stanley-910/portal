"use client";

import { useSelf } from "@liveblocks/react";
import { Fragment, useState } from "react";

import { HotelSearch } from "@/components/hotel-search/hotel-search";
import { LegBooking } from "@/components/multiplayer/leg-booking";
import { TripSplit } from "@/components/multiplayer/trip-split";
import { RoundButton } from "@/components/paper-atlas";
import { addDays, DateField, DayStrip, localIso, RouteHeader, Timeline } from "@/components/ticket-search/parts";
import { carrierLabel, duration } from "@/components/ticket-search/options";
import type { Currency, ExchangeRates } from "@/lib/currency";
import { useCurrencyPref } from "@/lib/currency-pref";
import { useExchangeRates } from "@/lib/exchange-rates";
import { memberColor, type Stay, type StoredOffer } from "@/lib/liveblocks/types";
import { editorChoice, stayDates } from "@/lib/trip/leg-edit";
import { usePlanActions, usePlanEnd, usePlanLegs, usePlanMembers, usePlanStays, useSplit, type EditResult, type PlanLeg } from "@/lib/trip/plan";
import type { HotelResult } from "@/lib/hotels/types";

// The shared plan: every leg anyone has drawn, its options, votes and pick. Styled like the ticket search
// popover; the data and every edit come from `@/lib/trip/plan`, so a redesign only replaces this file.

const SHOWN = 3;

const LEG_LABEL: Record<StoredOffer["mode"], string> = { flight: "Flight", train: "Train", bus: "Bus", ferry: "Ferry" };

const formatMoney = (m: { amount: number; currency: string }) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: m.currency, maximumFractionDigits: 0 }).format(m.amount);
/** "$152", "CN¥553" */
const money = (o: StoredOffer) => (o.price ? formatMoney(o.price) : null);
/** Departure time as the provider wrote it. Arrivals are left out: some providers give them in UTC, not local time. */
const time = (iso: string) => iso.slice(11, 16);

/** Why an edit didn't apply, said where the member made it. */
const REFUSED: Record<Exclude<EditResult, "ok">, string> = {
  gone: "This leg was removed.",
  locked: "This leg is being booked, so its pick is fixed.",
  replaced: "A new search replaced these options. Pick again.",
};

/** "W4 flight, leaves 07:25, 1 stop". A modelled option has no schedule, so it says "any time". */
const describe = (o: StoredOffer) =>
  [
    carrierLabel(o.carrier, o.mode),
    o.kind === "estimated" ? "any time" : `leaves ${time(o.depart)}`,
    o.stops ? `${o.stops} stop${o.stops > 1 ? "s" : ""}` : null,
  ]
    .filter(Boolean)
    .join(", ");

/** The plan panel. `onMinimise` folds it away, leaving each leg's ticket stub on its route (`LegTags`). */
export function TripPlan({ email = null, nationalities = [], onMinimise }: { email?: string | null; nationalities?: string[]; onMinimise?: () => void }) {
  const me = useSelf((s) => s.id);
  const legs = usePlanLegs();
  const split = useSplit();
  const mine = me ? split?.members[me] : null;
  const end = usePlanEnd();
  const { setEnds } = usePlanActions();
  const members = usePlanMembers();
  const stays = usePlanStays();
  const currency = useCurrencyPref();
  const rates = useExchangeRates();
  if (!legs?.length) return null;
  const stopLegs = legs.map((l) => ({ from: l.from.id, date: l.date }));
  return (
    <section aria-label="Trip plan" className="ts tp">
      {onMinimise ? (
        <div className="ts-topbar tp-bar">
          <span className="ts-step">Trip plan</span>
          <RoundButton
            label="Minimise"
            variant="quiet"
            className="ts-min"
            onClick={onMinimise}
            icon={
              <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden>
                <path d="M2 6 H10" />
              </svg>
            }
          />
        </div>
      ) : null}
      {mine?.totals && Object.keys(mine.totals).length ? (
        <div className="tp-total">
          Your share: {Object.entries(mine.totals).map(([currency, amount]) => new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount)).join(" + ")}
        </div>
      ) : null}
      {split && members ? <TripSplit split={split} legs={legs} members={members} stays={stays ?? {}} me={me ?? null} currency={currency} rates={rates} /> : null}
      <label className="tp-end">
        Trip ends
        <input type="date" value={end ?? ""} min={legs[legs.length - 1]?.date} onChange={(event) => setEnds(event.target.value || null)} />
      </label>
      {legs.map((leg, i) => (
        <Fragment key={leg.id}>
          {i > 0 ? <div className="ts-rule" /> : null}
          <LegCard
            leg={leg}
            stay={stays?.[leg.to.id] ?? null}
            hotelDates={stayDates({ nights: split?.nights ?? [], ends: split?.ends ?? end, legs: stopLegs }, { to: leg.to.id, date: leg.date, riders: leg.riders })}
            currency={currency}
            rates={rates}
            email={email}
            nationalities={nationalities}
          />
        </Fragment>
      ))}
    </section>
  );
}

function LegCard({
  leg,
  stay,
  hotelDates,
  currency,
  rates,
  email,
  nationalities,
}: {
  leg: PlanLeg;
  stay: Readonly<Stay> | null;
  /** The nights a hotel at this leg's destination is for (`stayDates`). */
  hotelDates: { checkIn: string; checkOut: string; people: number };
  currency: Currency;
  rates: ExchangeRates | null;
  email: string | null;
  nationalities: string[];
}) {
  const me = useSelf((s) => s.id);
  // a leg being bought keeps its date, riders and pick until a rider cancels the settle
  const locked = !!leg.booking;
  const members = usePlanMembers();
  const { setDate, retrySearch, vote, choose, setStay, toggleRider, removeLeg, setLeave } = usePlanActions();
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  // the option this member clicked in the editor; undefined until they do, so the editor follows picks made by others
  const [draft, setDraft] = useState<string | null | undefined>(undefined);
  const [pendingHotel, setPendingHotel] = useState<HotelResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const offers = leg.search.offers.slice(0, SHOWN);

  const stored = leg.chosen?.id ?? null;
  const choice = editorChoice(draft, stored, leg.search.offers.map((o) => o.id));
  const choiceChanged = !locked && choice !== stored;
  const changed = choiceChanged || pendingHotel !== null;

  const toggleEditor = () => {
    setDraft(undefined);
    setPendingHotel(null);
    setNotice(null);
    setEditing((value) => !value);
  };
  /** Picks an option for everyone straight from the list. */
  const pick = (offerId: string | null) => {
    const result = choose(leg.id, offerId);
    setNotice(result === "ok" ? null : REFUSED[result]);
  };
  const commit = () => {
    try {
      const chose = choiceChanged ? choose(leg.id, choice) : "ok";
      const stayed = pendingHotel
        ? setStay(leg.to.id, {
            label: pendingHotel.name,
            // the stay is the whole group's cost a night: every room it needs
            nightly: { amount: pendingHotel.pricePerNight.amount * pendingHotel.rooms, currency: pendingHotel.pricePerNight.currency },
            estimated: pendingHotel.freshness !== "live",
          })
        : "ok";
      if (stayed === "ok") setPendingHotel(null);
      if (chose === "ok") setDraft(undefined);
      const refused = chose !== "ok" ? chose : stayed !== "ok" ? stayed : null;
      setNotice(refused ? REFUSED[refused] : null);
      if (!refused) setEditing(false);
    } catch {
      // the room isn't connected or loaded yet
      setNotice("Couldn't save. Try again.");
    }
  };

  return (
    <article className="tp-leg">
      <RouteHeader from={{ code: leg.from.code, name: leg.from.name }} to={{ code: leg.to.code, name: leg.to.name }} />

      <div className="ts-dates">
        <DateField label="Depart" value={leg.date} open={picking} onToggle={() => !locked && setPicking((p) => !p)} />
        <div className="ts-field tp-riders">
          <span className="ts-field-label">Riders</span>
          <ul className="tp-rider-list">
            {members
              ? Object.entries(members).map(([id, info]) => (
                  <li key={id}>
                    <button
                      type="button"
                      className="tp-rider"
                      aria-pressed={leg.riders.includes(id)}
                      title={info.name}
                      disabled={locked}
                      onClick={() => toggleRider(leg.id, id)}
                      style={{ borderColor: memberColor(info.color) }}
                    >
                      {info.name.slice(0, 1).toUpperCase()}
                    </button>
                  </li>
                ))
              : null}
          </ul>
        </div>
        {me ? (
          <label className="tp-leave">
            My leave date
            <input type="date" value={members?.[me]?.leaves ?? ""} min={leg.date} onChange={(event) => setLeave(event.target.value || null)} />
          </label>
        ) : null}
      </div>

      {picking ? (
        <DayStrip
          start={addDays(localIso(new Date()), 1)}
          value={leg.date}
          label="Departure date"
          onPick={(iso) => {
            setPicking(false);
            if (iso !== leg.date) setDate(leg.id, iso);
          }}
        />
      ) : null}
      <div className="tp-edit-row">
        {stay ? (
          <span className="tp-stay">
            Stay: {stay.label ?? "Hotel selected"}
            {stay.nightly ? `, ${formatMoney(stay.nightly)} a night` : null}
            {stay.estimated ? <span className="ts-badge ts-badge-quiet">Estimated</span> : null}
          </span>
        ) : null}
        <button type="button" className="ts-oneway" aria-expanded={editing} onClick={toggleEditor}>
          {editing ? "Close edit" : "Edit trip"}
        </button>
      </div>
      {notice ? (
        <p className="tp-refused" role="status">
          {notice}
        </p>
      ) : null}

      {editing ? (
        <div className="tp-editor">
          {locked ? (
            <p className="ts-empty">Being booked, so the pick is fixed.</p>
          ) : (
            <div className="ts-rows">
              {offers.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className="ts-row"
                  aria-pressed={choice === o.id}
                  onClick={() => {
                    setNotice(null);
                    setDraft(choice === o.id ? null : o.id);
                  }}
                >
                  <span className="ts-head">
                    {duration(o.durationMin)}
                    {choice === o.id ? <span className="ts-badge">Selected</span> : null}
                  </span>
                  <span className="ts-price">{money(o) ?? "No fare"}</span>
                  <span className="ts-desc">{describe(o)}</span>
                </button>
              ))}
            </div>
          )}
          <HotelSearch
            city={leg.to.name}
            lat={leg.to.lat}
            lng={leg.to.lng}
            checkIn={hotelDates.checkIn}
            checkOut={hotelDates.checkOut}
            currency={currency}
            rates={rates}
            picked={pendingHotel}
            onPick={(hotel) => {
              setNotice(null);
              setPendingHotel(hotel);
            }}
            defaultOccupants={Math.min(4, Math.max(1, hotelDates.people))}
          />
          <button type="button" className="ts-oneway" disabled={!changed} onClick={commit}>
            Save changes
          </button>
        </div>
      ) : null}

      <div className="ts-rows">
        {leg.search.status === "searching"
          ? [0, 1, 2].map((i) => (
              <div key={i} className="ts-row ts-row-ghost" aria-hidden>
                <span className="ts-ghost ts-ghost-head" />
                <span className="ts-ghost ts-ghost-price" />
                <span className="ts-ghost ts-ghost-desc" />
                <span className="ts-ghost ts-ghost-line" />
              </div>
            ))
          : null}
        {leg.search.status === "failed" ? (
          <p className="ts-empty">
            Search failed.{" "}
            <button type="button" className="ts-oneway" onClick={() => retrySearch(leg.id)}>
              Try again
            </button>
          </p>
        ) : null}
        {leg.search.status === "done" && offers.length === 0 ? <p className="ts-empty">No routes found.</p> : null}
        {offers.map((o) => {
          const voters = leg.votes[o.id] ?? [];
          const chosen = leg.chosen?.id === o.id;
          const price = money(o);
          return (
            <div key={o.id} className="tp-offer">
              <button
                type="button"
                className="ts-row"
                aria-pressed={chosen}
                title={`${chosen ? "Picked" : "Pick"} for everyone. From ${o.provider}`}
                disabled={locked}
                onClick={() => pick(chosen ? null : o.id)}
              >
                <span className="ts-head">
                  {duration(o.durationMin)}
                  {chosen ? <span className="ts-badge">Picked</span> : null}
                  {o.kind !== "live" ? <span className="ts-badge ts-badge-quiet">Estimated</span> : null}
                </span>
                <span className="ts-price" data-none={!price || undefined}>
                  {price ?? "No fare"}
                </span>
                <span className="ts-desc">{describe(o)}</span>
                <Timeline legs={[{ kind: o.mode, minutes: o.durationMin, label: `${LEG_LABEL[o.mode]} ${duration(o.durationMin)}` }]} />
              </button>
              <button
                type="button"
                className="tp-vote"
                aria-pressed={!!me && voters.includes(me)}
                aria-label={`Vote, ${voters.length} so far`}
                onClick={() => vote(leg.id, o.id)}
              >
                <svg width={12} height={12} viewBox="0 0 16 16" aria-hidden>
                  <path d="M3.5 10.5L8 6l4.5 4.5" />
                </svg>
                {voters.length}
              </button>
            </div>
          );
        })}
      </div>

      <LegBooking leg={leg} email={email} nationalities={nationalities} />

      {locked ? null : (
        <button type="button" className="ts-oneway tp-remove" onClick={() => removeLeg(leg.id)}>
          Remove leg
        </button>
      )}
    </article>
  );
}
