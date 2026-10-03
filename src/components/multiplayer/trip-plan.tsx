"use client";

import { useSelf } from "@liveblocks/react";
import { Fragment, useState } from "react";

import { HotelSearch } from "@/components/hotel-search/hotel-search";
import { LegBooking } from "@/components/multiplayer/leg-booking";
import { RoundButton } from "@/components/paper-atlas";
import { addDays, DateField, DayStrip, localIso, RouteHeader, Timeline } from "@/components/ticket-search/parts";
import { carrierLabel, duration } from "@/components/ticket-search/options";
import { memberColor, type StoredOffer } from "@/lib/liveblocks/types";
import { useMySplit, usePlanActions, usePlanEnd, usePlanLegs, usePlanMembers, usePlanStays, type PlanLeg } from "@/lib/trip/plan";
import type { HotelResult } from "@/lib/hotels/types";
import { isBookable, shownOffers } from "@/lib/trip/offers";

// The shared plan: every leg anyone has drawn, its options, votes and pick. Styled like the ticket search
// popover; the data and every edit come from `@/lib/trip/plan`, so a redesign only replaces this file.

const SHOWN = 3;

const LEG_LABEL: Record<StoredOffer["mode"], string> = { flight: "Flight", train: "Train", bus: "Bus", ferry: "Ferry" };

/** "$152", "CN¥553" */
const money = (o: StoredOffer) =>
  o.price
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: o.price.currency, maximumFractionDigits: 0 }).format(o.price.amount)
    : null;
/** Departure time as the provider wrote it. Arrivals are left out: some providers give them in UTC, not local time. */
const time = (iso: string) => iso.slice(11, 16);

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
/** `bookLeg` is a leg to open at its booking, as Book on the home globe asks. */
export function TripPlan({ hostId, email = null, nationalities = [], bookLeg = null, onMinimise }: { hostId: string | null; email?: string | null; nationalities?: string[]; bookLeg?: string | null; onMinimise?: () => void }) {
  const me = useSelf((s) => s.id);
  const legs = usePlanLegs();
  const split = useMySplit();
  const end = usePlanEnd();
  const { setEnds } = usePlanActions();
  const members = usePlanMembers();
  const stays = usePlanStays();
  if (!legs?.length) return null;
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
      {split?.totals && Object.keys(split.totals).length ? (
        <div className="tp-total">
          Your share: {Object.entries(split.totals).map(([currency, amount]) => new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount)).join(" + ")}
        </div>
      ) : null}
      <label className="tp-end">
        Trip ends
        <input type="date" value={end ?? ""} min={legs[legs.length - 1]?.date} onChange={(event) => setEnds(event.target.value || null)} />
      </label>
      {legs.map((leg, i) => (
        <Fragment key={leg.id}>
          {i > 0 ? <div className="ts-rule" /> : null}
          <LegCard leg={leg} stay={stays?.[leg.to.id] ?? null} isHost={me === hostId} memberCount={members ? Object.keys(members).length : 1} email={email} nationalities={nationalities} focusBooking={leg.id === bookLeg} />
        </Fragment>
      ))}
    </section>
  );
}

function LegCard({ leg, stay, isHost, memberCount, email, nationalities, focusBooking = false }: { leg: PlanLeg; stay: { label: string | null; nightly: { amount: number; currency: string } | null } | null; isHost: boolean; memberCount: number; email: string | null; nationalities: string[]; focusBooking?: boolean }) {
  const me = useSelf((s) => s.id);
  // a leg being bought keeps its date, riders and pick until a rider cancels the settle
  const locked = !!leg.booking;
  const members = usePlanMembers();
  const { setDate, retrySearch, vote, choose, setStay, toggleRider, removeLeg, setLeave } = usePlanActions();
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pendingChoice, setPendingChoice] = useState(leg.chosen?.id ?? null);
  const [pendingHotel, setPendingHotel] = useState<HotelResult | null>(null);
  // the pick shows even when it's further down the options
  const offers = shownOffers(leg.search.offers, leg.chosen?.id, SHOWN);

  const changed = pendingChoice !== (leg.chosen?.id ?? null) || pendingHotel !== null;
  const commit = () => {
    choose(leg.id, pendingChoice);
    if (pendingHotel) {
      setStay(leg.to.id, {
        label: pendingHotel.name,
        nightly: { amount: pendingHotel.pricePerNight.amount * pendingHotel.rooms, currency: pendingHotel.pricePerNight.currency },
        estimated: pendingHotel.freshness !== "live",
      });
    }
    setPendingHotel(null);
    setEditing(false);
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
        {stay ? <span className="type-meta text-ink-muted">Stay: {stay.label ?? "Hotel selected"}</span> : null}
        {locked ? null : <button type="button" className="ts-oneway" onClick={() => setEditing((value) => !value)}>{editing ? "Close edit" : "Edit trip"}</button>}
      </div>

      {editing && !locked ? (
        <div className="tp-editor">
          <div className="ts-rows">
            {offers.map((o) => (
              <button key={o.id} type="button" className="ts-row" aria-pressed={pendingChoice === o.id} onClick={() => setPendingChoice(o.id)}>
                <span className="ts-head">{duration(o.durationMin)}{pendingChoice === o.id ? <span className="ts-badge">Selected</span> : null}</span>
                <span className="ts-price">{money(o) ?? "No fare"}</span>
                <span className="ts-desc">{describe(o)}</span>
              </button>
            ))}
          </div>
          {isHost ? (
            <HotelSearch
              city={leg.to.name}
              lat={leg.to.lat}
              lng={leg.to.lng}
              checkIn={leg.date}
              checkOut={addDays(leg.date, 1)}
              currency="USD"
              rates={null}
              picked={pendingHotel}
              onPick={setPendingHotel}
              defaultOccupants={Math.min(4, Math.max(1, memberCount))}
            />
          ) : null}
          <button type="button" className="ts-oneway" disabled={(!pendingChoice && !pendingHotel && !stay) || !changed} onClick={commit}>
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
                onClick={() => setPendingChoice(chosen ? null : o.id)}
              >
                <span className="ts-head">
                  {duration(o.durationMin)}
                  {chosen ? <span className="ts-badge">Picked</span> : null}
                  {o.kind !== "live" ? <span className="ts-badge ts-badge-quiet">Estimated</span> : null}
                  {isBookable(o) ? <span className="ts-badge ts-badge-quiet">Bookable</span> : null}
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

      <LegBooking leg={leg} email={email} nationalities={nationalities} focus={focusBooking} />

      {locked ? null : (
        <button type="button" className="ts-oneway tp-remove" onClick={() => removeLeg(leg.id)}>
          Remove leg
        </button>
      )}
    </article>
  );
}
