"use client";

import { useSelf } from "@liveblocks/react";
import { Activity, Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from "react";

import { EntryToggle } from "@/components/entry";
import { HotelSearch } from "@/components/hotel-search/hotel-search";
import { LegBooking } from "@/components/multiplayer/leg-booking";
import { BesidePanel, BesideProvider, useBeside } from "@/components/multiplayer/beside";
import { usePresentIds } from "@/components/multiplayer/presence";
import { CardBill } from "@/components/multiplayer/split-bill";
import { StayCard, TrashGlyph } from "@/components/multiplayer/stay-card";
import { legOffer } from "@/components/multiplayer/leg-tags";
import { RoundButton } from "@/components/paper-atlas";
import { dragAnchor, reveal, useAnchor } from "@/components/ticket-search/anchor";
import type { TripGlobeHandle } from "@/components/trip-globe";
import { HubChip, HubPicker } from "@/components/ticket-search/hub-picker";
import { addDays, dateLabel, DateField, DayStrip, localIso, OptionRows, RouteHeader, Timeline } from "@/components/ticket-search/parts";
import { AirlineLogo } from "@/components/ticket-search/airline-logo";
import { Glyph } from "@/components/ticket-search/glyphs";
import { carrierLabel, clockOf, duration } from "@/components/ticket-search/options";
import { formatMoney, inCurrency, type Currency, type ExchangeRates } from "@/lib/currency";
import { useCurrencyPref } from "@/lib/currency-pref";
import { useExchangeRates } from "@/lib/exchange-rates";
import { memberColor, type StoredOffer } from "@/lib/liveblocks/types";
import type { PlanStay } from "@/lib/trip/split";
import { legBefore } from "@/lib/trip/dates";
import { arrivalDate } from "@/lib/transport/arrival";
import { stayDates } from "@/lib/trip/leg-edit";
import { usePlanActions, usePlanDates, usePlanLegs, usePlanMembers, usePlanStays, type EditResult, type PlanLeg } from "@/lib/trip/plan";
import type { HotelResult } from "@/lib/hotels/types";
import { isBookable, refundNote } from "@/lib/trip/offers";
import { hubById } from "@/lib/transport/hubs/pick";
import type { Hub } from "@/lib/transport/hubs/types";
import { stopCountry } from "@/lib/trip/stops";

// The shared plan: every leg anyone has drawn, its options, votes and pick. Styled like the ticket search
// popover; the data and every edit come from `@/lib/trip/plan`, so a redesign only replaces this file.


const LEG_LABEL: Record<StoredOffer["mode"], string> = { flight: "Flight", train: "Train", bus: "Bus", ferry: "Ferry" };


/** Why an edit didn't apply, said where the member made it. */
const REFUSED: Record<Exclude<EditResult, "ok">, string> = {
  gone: "This leg was removed.",
  locked: "This leg is being booked, so its pick is fixed.",
  replaced: "A new search replaced these options. Pick again.",
};


/**
 * "W4 flight, 1 stop", or "train, from Shenzhen North". Its times ride on the timeline, which shows --:-- for a
 * modelled option with no schedule.
 */
const describe = (o: StoredOffer) =>
  [
    carrierLabel(o.carrier, o.mode),
    o.departs ? `from ${o.departs}` : null,
    o.stops ? `${o.stops} stop${o.stops > 1 ? "s" : ""}` : null,
  ]
    .filter(Boolean)
    .join(", ");

/**
 * The first day the depart strip offers: a few days before the leg's date so it can move either way, but never before
 * tomorrow or the leg that gets its riders there.
 */
function stripStart(date: string, after: string | null | undefined) {
  const floor = [addDays(localIso(new Date()), 1), after ?? ""].sort().at(-1)!;
  const centred = addDays(date, -3);
  return centred > floor ? centred : floor;
}

/** A leg someone asked to see, from its route, ticket stub or pins on the globe; `n` tells one ask from the next. */
export type LegFocus = { leg: string; n: number } | null;
type TripPlanProps = { bookLeg?: string | null; focus?: LegFocus; onMinimise?: () => void };
/** The header is a handle that moves the card; see `FloatingTripPlan`. */
type DragProps = { onDrag?: (event: PointerEvent<HTMLElement>) => void };

/** The plan as a card floating beside the trip's stops on the globe, like the solo ticket search, and clear of Pip. */
export function FloatingTripPlan({ globe, bill, ...props }: TripPlanProps & { globe: RefObject<TripGlobeHandle | null>; bill: { open: boolean; set: (open: boolean) => void } }) {
  const legs = usePlanLegs();
  const points = useMemo(() => (legs ?? []).flatMap((l) => [l.from, l.to]), [legs]);
  const { root, at, moveTo } = useAnchor(globe, points, (anchor) => reveal(anchor.firstElementChild as HTMLElement | null));
  /** Dragging the card by its header leaves it where it's dropped, until it's minimised and opened again. */
  const drag = (event: PointerEvent<HTMLElement>) => dragAnchor(event, at, moveTo);
  if (!legs?.length) return null;
  return (
    <div ref={root} data-globe-follow className="ts-anchor" style={{ "--alt": 0.8, visibility: "hidden" } as CSSProperties}>
      <BesideProvider bill={bill}>
        <TripPlan {...props} onDrag={drag} />
      </BesideProvider>
    </div>
  );
}

/** The plan panel. `onMinimise` folds it away, leaving each leg's ticket stub on its route (`LegTags`). */
/** `bookLeg` is a leg to open at its booking, as Book on the home globe asks. */
export function TripPlan({ bookLeg = null, focus = null, onMinimise, onDrag }: TripPlanProps & DragProps) {
  const legs = usePlanLegs();
  const stays = usePlanStays();
  const currency = useCurrencyPref();
  const rates = useExchangeRates();
  const dates = usePlanDates();
  if (!legs?.length) return null;
  const legDates = legs.map((l) => ({ from: l.from.id, date: l.date, riders: l.riders }));
  // the stays at a leg's destination from its arrival until the next leg into that stop, so a group arriving on
  // different legs each sees the stay they share
  const staysFor = (leg: PlanLeg) => {
    const arrival = arrivalDate(leg.date, leg.chosen);
    const next = legs.filter((l) => l.to.id === leg.to.id && l.date > leg.date).map((l) => l.date).sort()[0];
    return (stays ?? []).filter((s) => s.stop === leg.to.id && s.checkOut > arrival && (!next || s.checkIn < next));
  };
  return (
    <section aria-label="Trip plan" className="ts pa-cast tp-card tp">
      {onMinimise ? (
        <div className="ts-topbar tp-bar tp-head" data-draggable={onDrag ? "" : undefined} onPointerDown={onDrag} title={onDrag ? "Drag to move" : undefined}>
          <span className="tp-total">Your trip</span>
          <CardBill />
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
      {legs.map((leg, i) => (
        <Fragment key={leg.id}>
          {i > 0 ? <div className="ts-rule" /> : null}
          <LegCard
            leg={leg}
            dates={dates}
            stays={staysFor(leg)}
            hotelDatesFor={(offer) => stayDates(legDates, { to: leg.to.id, date: leg.date, arrival: arrivalDate(leg.date, offer), riders: leg.riders })}
            currency={currency}
            rates={rates}
            focusBooking={leg.id === bookLeg}
            focus={focus?.leg === leg.id ? focus.n : undefined}
          />
        </Fragment>
      ))}
    </section>
  );
}

function LegCard({
  leg,
  dates,
  stays,
  hotelDatesFor,
  currency,
  rates,
  focusBooking = false,
  focus,
}: {
  leg: PlanLeg;
  dates: ReturnType<typeof usePlanDates>;
  /** The stays at this leg's destination around its arrival. */
  stays: PlanStay[];
  /** The nights a new stay at this leg's destination starts with (`stayDates`). */
  hotelDatesFor: (offer: StoredOffer | null) => { checkIn: string; checkOut: string; people: number };
  currency: Currency;
  rates: ExchangeRates | null;
  focusBooking?: boolean;
  /** Set (to a new value each time) when this leg is asked for on the globe: it opens and scrolls into view. */
  focus?: number;
}) {
  // every price in the picked currency, or as it came when there are no rates for it
  const shown = (price: { amount: number; currency: string }) => formatMoney(inCurrency(price, currency, rates));
  const money = (o: StoredOffer) => (o.price ? shown(o.price) : null);
  // folded to its route and a line of what's settled, so the other legs stay in view; a leg opened to book starts open
  const [open, setOpen] = useState(focusBooking || focus !== undefined);
  // asked for again on the globe: open, wherever it was left
  const [asked, setAsked] = useState(focus);
  if (focus !== asked) {
    setAsked(focus);
    if (focus !== undefined) setOpen(true);
  }
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focus !== undefined) card.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);
  const me = useSelf((s) => s.id);
  // a leg being bought keeps its date, riders and pick until a rider cancels the settle
  const locked = !!leg.booking;
  const members = usePlanMembers();
  const present = usePresentIds();
  const allLegs = usePlanLegs();
  const { setDate, retrySearch, vote, choose, addStay, updateStay, removeStay, toggleRider, removeLeg, snapEnd } = usePlanActions();
  const [picking, setPicking] = useState(false);
  // the end whose hub is being picked, under the route
  const [hubEnd, setHubEnd] = useState<"from" | "to" | null>(null);
  const [dateBlocked, setDateBlocked] = useState(false);
  // the hotel search for this leg's destination, beside the card; a pick saves straight away
  const findStay = useBeside(`stay:${leg.id}`);
  const findButton = useRef<HTMLButtonElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // every option the leg kept, scrolling in their own box (OptionRows)
  const offers = leg.search.offers;
  const hotelDates = hotelDatesFor(leg.chosen);

  /** Picks an option for everyone straight from the list. */
  const pick = (offerId: string | null) => {
    const result = choose(leg.id, offerId);
    setNotice(result === "ok" ? null : REFUSED[result]);
  };
  /** Adds a hotel from the search as a stay for this leg's riders, from their arrival; its guests and dates are its own. */
  const pickStay = (hotel: HotelResult | null) => {
    if (!hotel) return;
    try {
      const result = addStay({
        stop: leg.to.id,
        checkIn: hotel.quote?.checkIn ?? hotelDates.checkIn,
        checkOut: hotel.quote?.checkOut ?? hotelDates.checkOut,
        guests: leg.riders.length ? leg.riders : me ? [me] : [],
        label: hotel.name,
        // the stay's cost a night: every room it needs
        nightly: { amount: hotel.pricePerNight.amount * hotel.rooms, currency: hotel.pricePerNight.currency },
        // Stored nightly budgets cannot retain the quote's date/party restrictions.
        estimated: true,
      });
      setNotice(result === "ok" ? null : REFUSED[result]);
      if (result === "ok") findStay.close();
    } catch {
      // the room isn't connected or loaded yet
      setNotice("Couldn't save. Try again.");
    }
  };

  /** Snaps one end of this leg to `hub` for everyone, or lets go of its hub (null); the leg searches again. */
  const pickHub = (end: "from" | "to", hub: Hub | null) => {
    setHubEnd(null);
    const result = snapEnd(leg.id, end, hub?.id ?? null);
    setNotice(result === "ok" ? null : REFUSED[result]);
  };
  const chip = (end: "from" | "to") => (
    <HubChip
      hub={hubById(leg[end].hub)}
      code={leg[end].code}
      snapped={!!leg[end].snapped}
      end={end}
      open={hubEnd === end}
      onToggle={() => {
        setPicking(false);
        setHubEnd((e) => (e === end ? null : end));
      }}
    />
  );

  const lead = legOffer(leg);
  const summary = [
    dateLabel(leg.date),
    lead ? `${carrierLabel(lead.carrier, lead.mode)}, ${money(lead) ?? "no fare"}` : "No pick yet",
    `${leg.riders.length} rider${leg.riders.length === 1 ? "" : "s"}`,
  ].join(" · ");

  return (
    <article ref={card} className="tp-leg">
      {/* the whole head folds the leg; opened, each end's hub can be picked, over it */}
      <div className="tp-leg-head">
        <button
          type="button"
          className="tp-leg-toggle"
          aria-expanded={open}
          aria-label={`${leg.from.name} to ${leg.to.name}`}
          onClick={() => {
            setOpen((o) => !o);
            setHubEnd(null);
          }}
        />
        <RouteHeader
          from={{ code: leg.from.code, name: leg.from.name, country: stopCountry(leg.from) }}
          to={{ code: leg.to.code, name: leg.to.name, country: stopCountry(leg.to) }}
          mode={lead?.mode ?? null}
          chips={open && !locked ? { from: chip("from"), to: chip("to") } : undefined}
          below={
            // the fold, under the route's middle, rather than a row of its own
            <svg className="tp-leg-chevron" width={10} height={10} viewBox="0 0 10 10" aria-hidden>
              <path d={open ? "M2 6.5 5 3.5 8 6.5" : "M2 3.5 5 6.5 8 3.5"} />
            </svg>
          }
        />
        {/* what's settled, while folded; opened, the leg shows it all below */}
        {open ? null : (
          <span className="tp-leg-summary">
            {lead ? <AirlineLogo code={lead.carrierCode} className="mr-1" /> : null}
            {summary}
          </span>
        )}
      </div>
      <Activity mode={open ? "visible" : "hidden"}>
        {hubEnd && !locked ? (
          <HubPicker
            key={hubEnd}
            near={leg[hubEnd]}
            current={hubById(leg[hubEnd].hub)}
            snapped={!!leg[hubEnd].snapped}
            label={hubEnd === "from" ? "Leave from" : "Arrive at"}
            onPick={(hub) => pickHub(hubEnd, hub)}
            onClose={() => setHubEnd(null)}
          />
        ) : null}

        <div className="ts-dates">
          <DateField label="Depart" value={leg.date} open={picking} onToggle={() => { if (locked) return; setHubEnd(null); setPicking((p) => !p); }} />
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
                        data-away={(present && !present.has(id)) || undefined}
                        title={present && !present.has(id) ? `${info.name} (away)` : info.name}
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
        </div>

        {picking ? (
          <DayStrip
            start={stripStart(leg.date, dates ? legBefore(dates, leg.id)?.date : null)}
            value={leg.date}
            label="Departure date"
            onPick={(iso) => {
              setPicking(false);
              setDateBlocked(iso !== leg.date && !setDate(leg.id, iso));
            }}
          />
        ) : null}
        {dateBlocked ? <p className="tp-hint type-meta text-ink-muted">A later leg is being booked, so this one can’t move past it.</p> : null}
        {notice ? (
          <p className="tp-refused" role="status">
            {notice}
          </p>
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
          <OptionRows picked={leg.chosen?.id}>
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
                      <AirlineLogo code={o.carrierCode} />
                      {duration(o.durationMin)}
                      {chosen ? <span className="ts-badge">Picked</span> : null}
                      {o.kind !== "live" ? <span className="ts-badge ts-badge-quiet">Estimated</span> : null}
                      {isBookable(o) ? <span className="ts-badge ts-badge-quiet">Bookable</span> : null}
                      {o.refund ? <span className="ts-badge ts-badge-quiet" title={refundNote(o)}>Refundable</span> : null}
                    </span>
                    <span className="ts-price" data-none={!price || undefined}>
                      {price ?? "No fare"}
                    </span>
                    <span className="ts-desc">{describe(o)}</span>
                    <Timeline
                      legs={[{ kind: o.mode, minutes: o.durationMin, label: `${LEG_LABEL[o.mode]} ${duration(o.durationMin)}` }]}
                      clock={clockOf(o.depart, o.arrive, o.durationMin, o.kind === "estimated")}
                      unscheduled={o.kind === "estimated"}
                    />
                  </button>
                  <button
                    type="button"
                    className="tp-vote"
                    aria-pressed={!!me && voters.includes(me)}
                    aria-label={`Vote, ${voters.length} so far`}
                    title={voters.length ? voters.map((v) => members?.[v]?.name ?? "Someone").join(", ") : "Vote"}
                    onClick={() => vote(leg.id, o.id)}
                  >
                    <svg width={12} height={12} viewBox="0 0 16 16" aria-hidden>
                      <path d="M3.5 10.5L8 6l4.5 4.5" />
                    </svg>
                    <span className="tp-vote-n">{voters.length}</span>
                    {/* who voted, in their colours, a few at most */}
                    {voters.length ? (
                      <span className="tp-voters" aria-hidden>
                        {voters.slice(0, 3).map((v) => (
                          <i key={v} style={{ background: memberColor(members?.[v]?.color ?? 1) }} />
                        ))}
                      </span>
                    ) : null}
                  </button>
                </div>
              );
            })}
          </OptionRows>
        </div>

        {stays.map((stay) => (
          <StayCard
            key={stay.id}
            stay={stay}
            members={members}
            currency={currency}
            rates={rates}
            onChange={(patch) => updateStay(stay.id, patch)}
            onRemove={() => removeStay(stay.id)}
            present={present}
          />
        ))}
        {findStay.open ? (
          <BesidePanel id={`stays-${leg.id}`} label={`Stays in ${leg.to.name}`} align={findButton} trigger={findButton} onClose={findStay.close}>
          <HotelSearch
            city={leg.to.name}
            lat={leg.to.lat}
            lng={leg.to.lng}
            checkIn={hotelDates.checkIn}
            checkOut={hotelDates.checkOut}
            currency={currency}
            rates={rates}
            picked={null}
            onPick={pickStay}
            defaultOccupants={Math.min(4, Math.max(1, hotelDates.people))}
          />
          </BesidePanel>
        ) : null}

        <LegBooking leg={leg} focus={focusBooking} />

        {/* the leg's actions, in one row: what it takes to get in, somewhere to sleep, and taking it off the trip */}
        <div className="tp-actions">
          <EntryToggle
            id={leg.id}
            label="Entry"
            className="tp-action"
            leg={{ fromCountry: stopCountry(leg.from) ?? undefined, toCountry: stopCountry(leg.to) ?? undefined, fromHub: leg.from.code ?? undefined, toHub: leg.to.code ?? undefined }}
            riders={leg.riders.map((id) => {
              const m = members?.[id];
              // where they go after this leg's destination: their next leg out of it
              const next = allLegs
                ?.filter((l) => l.id !== leg.id && l.from.id === leg.to.id && l.riders.includes(id) && l.date >= leg.date)
                .sort((x, y) => x.date.localeCompare(y.date))[0];
              return {
                id,
                name: m?.name ?? "Someone",
                passport: m?.nationalities?.[0] ?? null,
                passports: m?.nationalities?.slice(1),
                onwardCountry: next ? stopCountry(next.to) : null,
              };
            })}
          />
          <button ref={findButton} type="button" className="tp-action" aria-expanded={findStay.open} aria-controls={`stays-${leg.id}`} onClick={findStay.toggle}>
            <Glyph kind="hotel" size={13} />
            <span>Find a stay</span>
          </button>
          {locked ? null : (
            <button type="button" className="tp-action tp-action-end" onClick={() => removeLeg(leg.id)}>
              <TrashGlyph />
              <span>Remove leg</span>
            </button>
          )}
        </div>
      </Activity>
    </article>
  );
}
