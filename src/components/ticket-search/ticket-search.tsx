"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { Button } from "@/components/paper-atlas";
import type { Hub, LandedTrip, LatLng, TripGlobeHandle } from "@/components/trip-globe";
import type { Currency, ExchangeRates } from "@/lib/currency";
import type { HubSearchResult } from "@/lib/transport/hub-search";
import type { Offer } from "@/lib/transport/types";

import { formatPrice, rowPrice, rowsFor, TABS, visibleTabs, type Tab } from "./options";
import { addDays, DateField, DayStrip, localIso, RouteHeader, Timeline } from "./parts";
import { useOffers } from "./use-offers";

// The ticket search popover (design handoff "Ticket search popover", turn 3): the route, depart and return dates,
// and the three best options per tab. It anchors beside the landed route on the globe.

/** Keep at least this far from the viewport's edges. */
const EDGE = 24;
/** Clearance between the popover and the route's ends, wide enough to clear the hub tags. */
const GAP = 56;

type Side = "right" | "left" | "under" | "pinned";

/**
 * Keeps the popover beside the route as the globe turns: on the side with the most free space (right, left or
 * under), sticking with a side while it still fits, and pinned to the left edge when nothing fits.
 */
function useAnchor(globe: RefObject<TripGlobeHandle | null>, trip: LandedTrip, onPlaced: () => void) {
  const root = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  const placedCb = useRef(onPlaced);
  useEffect(() => {
    placedCb.current = onPlaced;
  });

  useEffect(() => {
    const g = globe.current;
    if (!g) return;
    let side: Side | null = null;
    const place = () => {
      const el = root.current;
      const box = el?.offsetParent as HTMLElement | null;
      const a = g.project(trip.origin);
      const b = g.project(trip.destination);
      if (!el || !box || !a || !b) return;
      const W = box.clientWidth;
      const H = box.clientHeight;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const nav = document.querySelector(".pn-bar")?.getBoundingClientRect().bottom ?? 0;
      const top = Math.max(EDGE, nav + 8);
      const minX = Math.min(a.x, b.x) - GAP;
      const maxX = Math.max(a.x, b.x) + GAP;
      const minY = Math.min(a.y, b.y) - GAP;
      const maxY = Math.max(a.y, b.y) + GAP;
      const room = { right: W - maxX - EDGE, left: minX - EDGE, under: H - maxY - EDGE };
      const fits = { right: room.right >= w, left: room.left >= w, under: room.under >= h, pinned: true };
      if (!side || !fits[side]) {
        side =
          fits.right || fits.left
            ? room.right >= room.left && fits.right
              ? "right"
              : fits.left
                ? "left"
                : "right"
            : fits.under
              ? "under"
              : "pinned";
      }
      const clampY = (y: number) => Math.min(Math.max(y, top), Math.max(top, H - h - EDGE));
      const clampX = (x: number) => Math.min(Math.max(x, EDGE), Math.max(EDGE, W - w - EDGE));
      const centreY = (minY + maxY) / 2 - h / 2;
      const [x, y] =
        side === "right"
          ? [maxX, clampY(centreY)]
          : side === "left"
            ? [minX - w, clampY(centreY)]
            : side === "under"
              ? [clampX((minX + maxX) / 2 - w / 2), maxY]
              : [EDGE, top];
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      if (!placed.current) {
        placed.current = true;
        el.style.visibility = "visible";
        placedCb.current();
      }
    };
    place();
    const off = g.onFrame(place);
    const resize = new ResizeObserver(place);
    if (root.current) resize.observe(root.current);
    return () => {
      off();
      resize.disconnect();
    };
  }, [globe, trip]);
  return root;
}

/** Clip-reveal from the top plus an 8 px drop. Skipped under reduced motion. */
function reveal(card: HTMLElement | null) {
  if (!card || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  card.animate(
    [
      { clipPath: "inset(-30px -30px 100% -30px)", transform: "translateY(-8px)" },
      { clipPath: "inset(-30px -30px -30px -30px)", transform: "none" },
    ],
    { duration: 540, easing: "cubic-bezier(.2,.75,.25,1)" },
  );
}

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
  });
  return {
    from: end(trip.from, pair?.from.hub, trip.origin),
    to: end(trip.to, pair?.to.hub, trip.destination),
  };
}

export interface TicketSearchProps {
  trip: LandedTrip;
  globe: RefObject<TripGlobeHandle | null>;
  currency: Currency;
  rates: ExchangeRates | null;
  /** Called with the selected option, every outbound option shown, and the dates when someone presses Save trip. */
  onAdd: (choice: { offer: Offer; offers: Offer[]; depart: string; return: string | null }) => void;
  /** The offer already added, which turns the button into a done state. */
  addedId?: string | null;
  /** A save is in flight: the button waits and says so. */
  saving?: boolean;
  /** Shown under the button when the last save failed. */
  error?: string | null;
  /** Esc, with no date strip open. A click outside is the globe's own cancel. */
  onDismiss: () => void;
}

/** Search transport for a landed trip. Mount it with a `key` per trip so each trip starts fresh. */
export function TicketSearch({ trip, globe, currency, rates, onAdd, addedId, saving = false, error, onDismiss }: TicketSearchProps) {
  const card = useRef<HTMLElement>(null);
  const [firstDay] = useState(() => localIso(trip.departDate));
  const [depart, setDepart] = useState(firstDay);
  const [returnDate, setReturnDate] = useState<string | null>(null);
  const [openField, setOpenField] = useState<"depart" | "return" | null>(null);
  const [tab, setTab] = useState<Tab>("best");
  const [selected, setSelected] = useState(0);

  const outbound = useOffers(trip.origin, trip.destination, depart);
  const back = useOffers(trip.destination, trip.origin, returnDate);
  const ends = endpoints(trip, outbound.result);

  const root = useAnchor(globe, trip, () => reveal(card.current));

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
  const returns = returnDate === null ? null : back.status === "done" ? back.offers : back.status === "failed" ? [] : undefined;

  const pickDay = (iso: string) => {
    if (openField === "return") setReturnDate(iso);
    else {
      setDepart(iso);
      if (returnDate && returnDate <= iso) setReturnDate(null);
      setSelected(0);
    }
    setOpenField(null);
  };

  return (
    <div ref={root} className="ts-anchor" style={{ visibility: "hidden" }}>
      <section ref={card} className="ts" aria-label={`Trip from ${ends.from.name} to ${ends.to.name}`}>
        <div className="ts-top">
          <RouteHeader from={ends.from} to={ends.to} distanceKm={trip.distanceKm} />

          <div className="ts-dates">
            <DateField
              label="Depart"
              value={depart}
              open={openField === "depart"}
              onToggle={() => setOpenField((f) => (f === "depart" ? null : "depart"))}
            />
            <DateField
              label="Return"
              value={returnDate}
              open={openField === "return"}
              onToggle={() => setOpenField((f) => (f === "return" ? null : "return"))}
            />
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
                <button
                  type="button"
                  className="ts-oneway"
                  onClick={() => {
                    setReturnDate(null);
                    setOpenField(null);
                  }}
                >
                  Keep one way
                </button>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="ts-rule" />

        <div className="ts-bottom">
          <div className="ts-tabs" role="tablist">
            {TABS.filter((t) => tabs.includes(t.id)).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                className="ts-tab"
                aria-selected={t.id === activeTab}
                onClick={() => {
                  setTab(t.id);
                  setSelected(0);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="ts-rows" role="tabpanel">
            {outbound.status === "searching" || outbound.status === "idle"
              ? [0, 1, 2].map((i) => (
                  <div key={i} className="ts-row ts-row-ghost" aria-hidden>
                    <span className="ts-ghost ts-ghost-head" />
                    <span className="ts-ghost ts-ghost-price" />
                    <span className="ts-ghost ts-ghost-desc" />
                    <span className="ts-ghost ts-ghost-line" />
                  </div>
                ))
              : null}
            {outbound.status === "failed" ? (
              <p className="ts-empty">
                Search failed.{" "}
                <button type="button" className="ts-oneway" onClick={outbound.retry}>
                  Try again
                </button>
              </p>
            ) : null}
            {outbound.status === "done" && rows.length === 0 ? <p className="ts-empty">No routes found.</p> : null}
            {rows.map((row, i) => {
              const price = returns === undefined ? undefined : rowPrice(row.offer, returns, currency, rates);
              return (
                <button
                  key={row.offer.id}
                  type="button"
                  className="ts-row"
                  aria-pressed={row === choice}
                  title={row.source}
                  onClick={() => setSelected(i)}
                >
                  <span className="ts-head">
                    {row.headline}
                    {row.badge ? <span className="ts-badge">{row.badge}</span> : null}
                    {row.estimated ? <span className="ts-badge ts-badge-quiet">Estimated</span> : null}
                  </span>
                  <span className="ts-price" data-none={price === null || undefined}>
                    {price === undefined ? <span className="ts-ghost ts-ghost-price" /> : price === null ? "No fare" : formatPrice(price, currency)}
                  </span>
                  <span className="ts-desc">{row.description}</span>
                  <Timeline legs={row.legs} />
                </button>
              );
            })}
          </div>

          <Button
            block
            disabled={!choice || choice.offer.id === addedId || saving}
            aria-busy={saving || undefined}
            onClick={() => choice && onAdd({ offer: choice.offer, offers, depart, return: returnDate })}
          >
            {saving ? "Saving trip…" : choice && choice.offer.id === addedId ? "Saved" : "Save trip"}
          </Button>
          {error && !saving ? (
            <p className="ts-empty" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
