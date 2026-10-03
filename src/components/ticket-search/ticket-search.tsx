"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

import { Button, RoundButton } from "@/components/paper-atlas";
import { HotelSearch } from "@/components/hotel-search/hotel-search";
import type { Hub, LandedTrip, LatLng, TripGlobeHandle } from "@/components/trip-globe";
import type { Currency, ExchangeRates } from "@/lib/currency";
import type { HotelResult } from "@/lib/hotels/types";
import { arrivalDate } from "@/lib/transport/arrival";
import { distanceKm } from "@/lib/transport/hubs/geo";
import type { HubSearchResult } from "@/lib/transport/hub-search";
import type { Mode, Offer } from "@/lib/transport/types";
import type { PickedStay, ReturnPick } from "@/lib/trip/solo-input";
import { isBookable } from "@/lib/trip/offers";

import { credits, formatPrice, rowPrice, rowsFor, TABS, tripPrice, visibleTabs, type OptionRow, type Tab } from "./options";
import { AirlineLogo } from "./airline-logo";
import { Glyph } from "./glyphs";
import { addDays, DateField, DayStrip, localIso, RouteHeader, Timeline } from "./parts";
import { TripTag, useTagOnRoute } from "./trip-tag";
import { useOffers } from "./use-offers";
import { reveal, useAnchor } from "./anchor";

// The ticket search popover (design handoff "Ticket search popover", turn 3): the route, depart and return dates,
// and the three best options per tab. It anchors beside the landed route on the globe.

const SAVE_LABEL: Record<Mode, string> = {
  flight: "Save flight",
  train: "Save train",
  bus: "Save bus",
  ferry: "Save ferry",
};

/** "22.30, 114.17", for a point outside every bundled hub's radius. */
const coordinates = (p: LatLng) => `${p.lat.toFixed(2)}, ${p.lng.toFixed(2)}`;
const airportCode = (hub: Hub | null | undefined) => (hub?.mode === "flight" ? hub.code : null);

/**
 * Each end named by its city: the globe's preview hub first, so the header doesn't change when results land, then
 * the hub pair behind the top result, then the clicked point itself.
 */
function endpoints(trip: LandedTrip, result: HubSearchResult | null) {
  const top = result?.offers[0];
  const pairId = top && result.offerPairs[top.id]?.[0];
  const pair = result?.hubs.pairs.find((p) => p.id === pairId) ?? result?.hubs.pairs[0];
  const end = (preview: Hub | null, resolved: Hub | undefined, point: LatLng) => ({
    name: preview?.city || resolved?.city || preview?.name || resolved?.name || coordinates(point),
    code: airportCode(preview) ?? airportCode(resolved),
    country: preview?.country ?? resolved?.country ?? null,
    // a hub or city near the point, rather than open sea or countryside named by its coordinates
    known: Boolean(preview || resolved),
  });
  return {
    from: end(trip.from, pair?.from.hub, trip.origin),
    to: end(trip.to, pair?.to.hub, trip.destination),
  };
}

export type { PickedStay };

/** A picked hotel as the trip's stay: every room it takes, for one night. */
const stayFrom = (hotel: HotelResult): PickedStay => ({
  label: hotel.rooms > 1 ? `${hotel.name}, ${hotel.rooms} rooms` : hotel.name,
  nightly: { amount: hotel.pricePerNight.amount * hotel.rooms, currency: hotel.pricePerNight.currency },
  // Saved stays lack quote dates/party/source, so their nightly budget is always an estimate.
  estimated: true,
});

/** "$905", or "No fare" when an option has none or there's no rate for it. */
const priceText = (price: number | null, currency: Currency) => (price === null ? "No fare" : formatPrice(price, currency));

const samePoint = (a: LatLng, b: LatLng) => a.lat === b.lat && a.lng === b.lng;

/** One end of a route named for its hub's city, or its coordinates outside every hub's radius. */
const placeEnd = (hub: Hub | null, point: LatLng) => ({
  name: hub?.city || hub?.name || coordinates(point),
  code: airportCode(hub),
  country: hub?.country ?? null,
  known: Boolean(hub),
});

/**
 * One direction's options: placeholder rows while searching, the three best rows for the tab, and the providers
 * credited under them. Every row says where its data came from and marks anything that isn't live.
 */
function OptionList({
  status, slow = false, rows, choice, currency, rates, onPick, onRetry, empty,
}: {
  status: "idle" | "searching" | "failed" | "done";
  /** A provider is taking its time: still a search, not a failure. */
  slow?: boolean;
  rows: OptionRow[];
  choice: OptionRow | undefined;
  currency: Currency;
  rates: ExchangeRates | null;
  onPick: (index: number) => void;
  onRetry: () => void;
  empty: ReactNode;
}) {
  const credited = credits(rows, choice);
  return (
    <div className="ts-rows" role="tabpanel">
      {status === "searching" || status === "idle"
        ? [0, 1, 2].map((i) => (
            <div key={i} className="ts-row ts-row-ghost" aria-hidden>
              <span className="ts-ghost ts-ghost-head" />
              <span className="ts-ghost ts-ghost-price" />
              <span className="ts-ghost ts-ghost-desc" />
              <span className="ts-ghost ts-ghost-line" />
            </div>
          ))
        : null}
      {/* a slow provider is still a search, not a failure: the answer comes, with estimates if it must */}
      {status === "searching" && slow ? (
        <p className="ts-empty" role="status">
          Still looking.
        </p>
      ) : null}
      {status === "failed" ? (
        <p className="ts-empty">
          Search failed.{" "}
          <button type="button" className="ts-oneway" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : null}
      {status === "done" && rows.length === 0 ? <p className="ts-empty">{empty}</p> : null}
      {rows.map((row, i) => {
        const price = rowPrice(row.offer, currency, rates);
        return (
          <button
            key={row.offer.id}
            type="button"
            className="ts-row"
            aria-pressed={row === choice}
            title={row.source}
            onClick={() => onPick(i)}
          >
            <span className="ts-head">
              <AirlineLogo code={row.offer.segments[0].carrierCode} />
              {row.headline}
              {row.badge ? <span className="ts-badge">{row.badge}</span> : null}
              {row.estimated ? <span className="ts-badge ts-badge-quiet">Estimated</span> : null}
            {isBookable(row.offer) ? <span className="ts-badge ts-badge-quiet">Bookable</span> : null}
            {row.offer.sandbox ? <span className="ts-badge ts-badge-quiet">Sandbox</span> : null}
            </span>
            <span className="ts-price" data-none={price === null || undefined}>
              {priceText(price, currency)}
            </span>
            <span className="ts-desc">{row.description}</span>
            <Timeline legs={row.legs} />
          </button>
        );
      })}
      {credited.length ? (
        <p className="ts-credit">
          Source:{" "}
          {credited.map((c, i) => (
            <span key={c.label}>
              {i ? " · " : null}
              {c.url ? (
                <a href={c.url} target="_blank" rel="noopener noreferrer">
                  {c.label}
                </a>
              ) : (
                c.label
              )}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

export interface TicketSearchProps {
  trip: LandedTrip;
  globe: RefObject<TripGlobeHandle | null>;
  currency: Currency;
  rates: ExchangeRates | null;
  /**
   * Called with the selected option, every outbound option shown, and the depart date when someone presses Save trip.
   * `return` is the way back picked for a round trip, with every return option shown and the return date. `stay` is
   * the hotel picked in the Hotels tab, as the group's nightly cost there.
   */
  onAdd: (choice: { offer: Offer | null; offers: Offer[]; depart: string; return: ReturnPick | null; stay: PickedStay | null }) => void;
  /** Where the trip started, which a return goes back to: the first leg's start. Defaults to this leg's. */
  home?: Pick<LandedTrip, "origin" | "from">;
  /** The offer already added, which turns the button into a done state. */
  addedId?: string | null;
  /** A save is in flight: the button waits and says so. */
  saving?: boolean;
  /** Shown under the button when the last save failed. */
  error?: string | null;
  /** The saved trip's page, once saved: a link under the button opens it. */
  savedHref?: string;
  /**
   * Book: shown on the last leg when its pick, or an earlier leg's (`canBook`), can be bought in the app. Pressing it
   * saves through `onAdd` first unless the pick is already saved; `saved` says which.
   */
  onBook?: (saved: boolean) => void;
  canBook?: boolean;
  /** Esc, with no date strip open. A click outside is the globe's own cancel. */
  onDismiss: () => void;
  /**
   * Which leg of a trip with stops this is. Before the last leg the button moves on to the next instead of saving,
   * and there is no return date: only the last leg can come back home. `onBack` goes back to the leg before.
   */
  step?: { index: number; count: number; onBack?: () => void };
  /** Folded away, leaving only the ticket stub on the route. Clicking the stub, or the route itself, calls `onExpand`. */
  collapsed?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
}

/** Search transport for a landed trip. Mount it with a `key` per trip so each trip starts fresh. */
export function TicketSearch({
  trip, globe, currency, rates, onAdd, home, addedId, saving = false, error, savedHref, onBook, canBook = false, onDismiss, step, collapsed = false, onCollapse, onExpand,
}: TicketSearchProps) {
  const multi = !!step && step.count > 1;
  const next = !!step && step.index < step.count - 1;
  const homePoint = home?.origin ?? trip.origin;
  // a leg that already ends where the trip started has nowhere to return to
  const canReturn = !next && !samePoint(homePoint, trip.destination);
  const card = useRef<HTMLElement>(null);
  const [firstDay] = useState(() => localIso(trip.departDate));
  const [depart, setDepart] = useState(firstDay);
  const [returnDate, setReturnDate] = useState<string | null>(null);
  const [openField, setOpenField] = useState<"depart" | "return" | null>(null);
  const [tab, setTab] = useState<Tab>("best");
  // the Hotels tab sits beside the route tabs; the route pick stays what Save trip saves
  const [hotelsOpen, setHotelsOpen] = useState(false);
  const [hotelSelection, setHotelSelection] = useState<{ hotel: HotelResult; scope: string } | null>(null);
  const [selected, setSelected] = useState(0);
  // a round trip picks the way out, then the way back from its own list
  const [leg, setLeg] = useState<"out" | "back">("out");
  const [backTab, setBackTab] = useState<Tab>("best");
  const [backSelected, setBackSelected] = useState(0);

  const outbound = useOffers(trip.origin, trip.destination, depart);
  const back = useOffers(trip.destination, homePoint, returnDate);
  const ends = endpoints(trip, outbound.result);
  const homeEnd = home && !samePoint(home.origin, trip.origin) ? placeEnd(home.from, home.origin) : ends.from;

  const anchorPoints = useMemo(() => [trip.origin, trip.destination], [trip.origin, trip.destination]);
  const { root } = useAnchor(globe, anchorPoints, () => reveal(card.current));
  const chip = useTagOnRoute(globe, trip.origin, trip.destination);
  // opening it again replays the reveal
  const wasCollapsed = useRef(collapsed);
  useEffect(() => {
    if (wasCollapsed.current && !collapsed) reveal(card.current);
    wasCollapsed.current = collapsed;
  }, [collapsed]);

  // Esc closes an open date strip first, then the popover. Listening on window lets menus that handle Esc on the
  // document mark it handled first.
  const escape = useRef(() => {});
  useLayoutEffect(() => {
    escape.current = () => (openField ? setOpenField(null) : onDismiss());
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) escape.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const offers = outbound.status === "done" ? outbound.offers : [];
  const tabs = visibleTabs(offers);
  const activeTab = tabs.includes(tab) ? tab : "best";
  const rows = rowsFor(offers, activeTab, rates);
  const choice = rows[Math.min(selected, rows.length - 1)];
  const roundTrip = returnDate !== null;
  const backOffers = roundTrip && back.status === "done" ? back.offers : [];
  const backTabs = visibleTabs(backOffers);
  const activeBackTab = backTabs.includes(backTab) ? backTab : "best";
  const backRows = rowsFor(backOffers, activeBackTab, rates);
  const backChoice = roundTrip ? backRows[Math.min(backSelected, backRows.length - 1)] : undefined;
  const showBack = roundTrip && leg === "back";
  const hotelCheckIn = arrivalDate(depart, choice ? { kind: choice.offer.kind,
    depart: choice.offer.segments[0]?.depart, arrive: choice.offer.segments.at(-1)?.arrive } : null);
  const hotelCheckOut = returnDate ?? addDays(hotelCheckIn, 1);
  const hotelScope = `${hotelCheckIn}/${hotelCheckOut}`;
  const hotel = hotelCheckOut > hotelCheckIn && hotelSelection?.scope === hotelScope ? hotelSelection.hotel : null;
  const setHotel = (value: HotelResult | null) => setHotelSelection(value ? { hotel: value, scope: hotelScope } : null);

  const pickDay = (iso: string) => {
    if (openField === "return") {
      setReturnDate(iso);
      setBackSelected(0);
    } else {
      setDepart(iso);
      if (returnDate && returnDate <= iso) {
        setReturnDate(null);
        setLeg("out");
      }
      setSelected(0);
    }
    setHotel(null);
    setOpenField(null);
  };
  const oneWay = () => {
    setReturnDate(null);
    setLeg("out");
    setOpenField(null);
  };

  // the trip's whole fare once both ways are picked, else the way out's
  const total = choice && backChoice ? tripPrice([choice.offer, backChoice.offer], currency, rates) : null;
  const chipPrice = total ?? (choice ? rowPrice(choice.offer, currency, rates) : null);
  // what Save trip saved last: a round trip's last leg is the way back
  const added = !!addedId && (roundTrip ? backChoice?.offer.id === addedId : choice?.offer.id === addedId);
  const short = (end: { name: string; code: string | null }) => end.code ?? end.name;

  return (
    <>
    {/* the trip's ticket stub always rides on its route; it opens and folds the card */}
    <TripTag
      ref={chip}
      mode={choice?.offer.mode ?? "flight"}
      from={short(ends.from)}
      to={short(ends.to)}
      price={chipPrice ? formatPrice(chipPrice, currency) : null}
      className="pa-cast"
      style={{ "--alt": 0.3, visibility: "hidden" } as CSSProperties}
      aria-label={`${collapsed ? "Show" : "Fold"} trip from ${ends.from.name} to ${ends.to.name}`}
      aria-expanded={!collapsed}
      onClick={collapsed ? onExpand : onCollapse}
    />
    <div ref={root} data-globe-follow className="ts-anchor pa-cast" style={{ "--alt": 0.8, visibility: "hidden" } as CSSProperties} hidden={collapsed}>
      <section ref={card} className="ts" aria-label={`Trip from ${ends.from.name} to ${ends.to.name}`}>
        <div className="ts-top">
          <div className="ts-topbar">
            <RoundButton label="Delete flight" variant="quiet" className="ts-dismiss" onClick={onDismiss} />
            {multi ? (
              <div className="ts-step">
                <span>
                  Leg {step.index + 1} of {step.count}
                </span>
                {step.onBack ? (
                  <button type="button" className="ts-oneway" onClick={step.onBack}>
                    Back
                  </button>
                ) : null}
              </div>
            ) : null}
            {onCollapse ? (
              <RoundButton
                label="Minimise"
                variant="quiet"
                className="ts-min"
                onClick={onCollapse}
                icon={
                  <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden>
                    <path d="M2 6 H10" />
                  </svg>
                }
              />
            ) : null}
          </div>
          {showBack ? (
            <RouteHeader from={ends.to} to={homeEnd} distanceKm={Math.round(distanceKm(trip.destination, homePoint))} mode={backChoice?.offer.mode} />
          ) : (
            <RouteHeader from={ends.from} to={ends.to} distanceKm={trip.distanceKm} mode={choice?.offer.mode} />
          )}

          <div className="ts-dates">
            <DateField
              label="Depart"
              value={depart}
              open={openField === "depart"}
              onToggle={() => setOpenField((f) => (f === "depart" ? null : "depart"))}
            />
            {canReturn ? (
              <DateField
                label="Return"
                value={returnDate}
                open={openField === "return"}
                onToggle={() => setOpenField((f) => (f === "return" ? null : "return"))}
              />
            ) : null}
          </div>

          {openField ? (
            <>
              <DayStrip
                start={openField === "return" ? addDays(depart, 1) : firstDay}
                value={openField === "return" ? returnDate : depart}
                label={openField === "depart" ? "Departure date" : "Return date"}
                onPick={pickDay}
              />
              {openField === "return" && returnDate ? (
                <button type="button" className="ts-oneway" onClick={oneWay}>
                  Keep one way
                </button>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="ts-rule" />

        <div className="ts-bottom">
          {showBack && choice ? (
            <div className="ts-picked">
              <span className="ts-picked-label">Out</span>
              <span className="ts-picked-what">{choice.description}</span>
              <span className="ts-price" data-none={rowPrice(choice.offer, currency, rates) === null || undefined}>
                {priceText(rowPrice(choice.offer, currency, rates), currency)}
              </span>
              <button type="button" className="ts-oneway" onClick={() => setLeg("out")}>
                Change
              </button>
            </div>
          ) : null}

          <div className="ts-tabs" role="tablist" aria-label={showBack ? "Return options" : roundTrip ? "Outbound options" : "Options"}>
            {TABS.filter((t) => (showBack ? backTabs : tabs).includes(t.id)).map((t) => (
              <Fragment key={t.id}>
                <button
                  type="button"
                  role="tab"
                  className="ts-tab"
                  aria-selected={!hotelsOpen && t.id === (showBack ? activeBackTab : activeTab)}
                  aria-label={t.id === "best" ? undefined : t.label}
                  title={t.id === "best" ? undefined : t.label}
                  onClick={() => {
                    setHotelsOpen(false);
                    if (showBack) {
                      setBackTab(t.id);
                      setBackSelected(0);
                    } else {
                      setTab(t.id);
                      setSelected(0);
                    }
                  }}
                >
                  {t.id === "best" ? t.label : <Glyph kind={t.id} size={15} />}
                </button>
                {t.id === "flight" && ends.to.known && !showBack ? (
                  <button
                    type="button"
                    role="tab"
                    className="ts-tab"
                    aria-selected={hotelsOpen}
                    aria-label="Hotels"
                    title="Hotels"
                    onClick={() => setHotelsOpen(true)}
                  >
                    <Glyph kind="hotel" size={15} />
                  </button>
                ) : null}
              </Fragment>
            ))}
          </div>

          {hotelsOpen && ends.to.known && !showBack ? (
            hotelCheckOut <= hotelCheckIn ? <p className="ts-empty">No overnight stay before the return departure.</p> : <HotelSearch
              city={ends.to.name}
              lat={trip.destination.lat}
              lng={trip.destination.lng}
              checkIn={hotelCheckIn}
              checkOut={hotelCheckOut}
              currency={currency}
              rates={rates}
              picked={hotel}
              onPick={setHotel}
              tabPanel
            />
          ) : showBack ? (
            <OptionList
              status={back.status}
              slow={back.slow}
              rows={backRows}
              choice={backChoice}
              currency={currency}
              rates={rates}
              onPick={setBackSelected}
              onRetry={back.retry}
              empty={
                <>
                  No routes back found.{" "}
                  <button type="button" className="ts-oneway" onClick={oneWay}>
                    Keep one way
                  </button>
                </>
              }
            />
          ) : (
            <OptionList
              status={outbound.status}
              slow={outbound.slow}
              rows={rows}
              choice={choice}
              currency={currency}
              rates={rates}
              onPick={setSelected}
              onRetry={outbound.retry}
              empty="No routes found."
            />
          )}

          {showBack && total !== null ? (
            <p className="ts-total">
              <span>Round trip</span>
              <span>{formatPrice(total, currency)}</span>
            </p>
          ) : null}

          <Button
            block
            className="ts-save"
            disabled={saving || added || (roundTrip ? !choice || (showBack && !backChoice) : !choice && !hotel)}
            aria-busy={saving || undefined}
            onClick={() => {
              if (roundTrip && !showBack) {
                setHotelsOpen(false);
                return setLeg("back");
              }
              onAdd({
                offer: choice?.offer ?? null,
                offers,
                depart,
                return: returnDate && backChoice ? { offer: backChoice.offer, offers: backOffers, date: returnDate } : null,
                stay: hotel ? stayFrom(hotel) : null,
              });
            }}
          >
            {saving
              ? "Saving trip…"
              : added
                ? "Saved"
                : next
                  ? hotel ? "Next leg with stay" : "Next leg"
                  : roundTrip
                    ? showBack
                      ? hotel ? "Save round trip with stay" : "Save round trip"
                      : "Choose return"
                    : hotel && choice
                      ? "Save trip with stay"
                      : hotel
                        ? "Save hotel"
                        : choice
                          ? SAVE_LABEL[choice.offer.mode]
                          : "Save trip"}
          </Button>
          {onBook && !next && (canBook || (choice && isBookable(choice.offer))) ? (
            <Button
              variant="secondary"
              block
              className="ts-save"
              disabled={saving || (!choice && !hotel)}
              onClick={() => {
                const saved = !!choice && choice.offer.id === addedId;
                if (!saved) {
                  onAdd({
                    offer: choice?.offer ?? null,
                    offers,
                    depart,
                    return: returnDate && backChoice ? { offer: backChoice.offer, offers: backOffers, date: returnDate } : null,
                    stay: hotel ? stayFrom(hotel) : null,
                  });
                }
                onBook(saved);
              }}
            >
              Book
            </Button>
          ) : null}
          {error && !saving ? (
            <p className="ts-empty" role="alert">
              {error}
            </p>
          ) : null}
          {savedHref && !saving ? (
            <p className="ts-empty" role="status">
              Saved to your trips ·{" "}
              <a href={savedHref} className="underline underline-offset-2">
                Open
              </a>
            </p>
          ) : null}
        </div>
      </section>
    </div>
    </>
  );
}
