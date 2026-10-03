"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { PixelIcon } from "@/components/paper-atlas";
import type { Mode } from "@/lib/transport/types";

import { Glyph, RailGlyph } from "./glyphs";
import type { Clock, TimelineLeg } from "./options";
import { PixelFlag } from "./pixel-flag";

// Pieces of the ticket search popover that the trip plan reuses: the route header, a date field with its one-week
// strip, and the leg timeline. Styles: ticket-search.css.

const DAY_MS = 86_400_000;

/** YYYY-MM-DD in the viewer's own time zone. */
export const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const dayParts = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return {
    weekday: d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
    day: d.getUTCDate(),
    month: d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }),
  };
};

/** "Sun Oct 4": month first, as every date in the app reads */
export const dateLabel = (iso: string) => {
  const p = dayParts(iso);
  return `${p.weekday} ${p.month} ${p.day}`;
};


/** Station codes like "HK-WEST-KOWLOON" are catalogue ids, not something to print. */
const IATA = /^[A-Z]{3}$/;
/** "Shanghai (Minhang)" → "Shanghai": airport data names the district, the card names the city. */
const cityName = (name: string) => name.replace(/\s*\([^)]*\)$/, "");

/**
 * The route as it's charted on the globe, in little: a ring where it leaves, a dashed line, a ringed dot where it lands,
 * and the vehicle in the middle of the line when there is one. It stretches to fill the gap between the two names.
 */
function RouteArc({ mode }: { mode?: Mode | null }) {
  return (
    <span className="ts-arc" aria-hidden>
      <span className="ts-arc-from" />
      <span className="ts-arc-path" />
      <span className="ts-arc-to" />
      {mode ? <Glyph kind={mode} size={13} className="ts-arc-glyph" /> : null}
    </span>
  );
}

/** City to city: each end's flag, names as the title, an airport code beneath when there is one, the route between, and the distance when known. */
export function RouteHeader({
  from,
  to,
  distanceKm,
  mode = null,
  below,
}: {
  from: { code?: string | null; name: string; country?: string | null };
  to: { code?: string | null; name: string; country?: string | null };
  distanceKm?: number;
  /** What's taking them, shown on the route. */
  mode?: Mode | null;
  /** Under the route's middle, in place of the distance: e.g. a fold chevron. */
  below?: ReactNode;
}) {
  return (
    <div className="ts-route">
      <span className="ts-place">
        <span className="ts-place-line">
          {from.country ? <PixelFlag country={from.country} /> : null}
          <span className="ts-city">{cityName(from.name)}</span>
        </span>
        {from.code && IATA.test(from.code) ? <span className="ts-code">{from.code}</span> : null}
      </span>
      <span className="ts-distance">
        <RouteArc mode={mode} />
        {below ?? (distanceKm === undefined ? null : <span>{distanceKm.toLocaleString("en-US")} km</span>)}
      </span>
      <span className="ts-place ts-place-end">
        <span className="ts-place-line">
          <span className="ts-city">{cityName(to.name)}</span>
          {to.country ? <PixelFlag country={to.country} /> : null}
        </span>
        {to.code && IATA.test(to.code) ? <span className="ts-code">{to.code}</span> : null}
      </span>
    </div>
  );
}

/** A 52 px date button. With no value it shows `empty` in muted text. With `onClear` and a value, a small ✕ at its
 * end takes the date off (a return, to keep the trip one way). */
export function DateField({
  label,
  value,
  empty = "Add date",
  open,
  onToggle,
  onClear,
  clearLabel = "Clear date",
}: {
  label: string;
  value: string | null;
  empty?: string;
  open: boolean;
  onToggle: () => void;
  onClear?: () => void;
  clearLabel?: string;
}) {
  const field = (
    <button type="button" className="ts-field" aria-expanded={open} onClick={onToggle}>
      <span className="ts-field-label">{label}</span>
      <span className="ts-field-value" data-empty={!value || undefined}>
        {value ? dateLabel(value) : empty}
      </span>
    </button>
  );
  if (!onClear || !value) return field;
  return (
    <span className="ts-field-wrap">
      {field}
      <button type="button" className="ts-field-clear" aria-label={clearLabel} title={clearLabel} onClick={onClear}>
        <PixelIcon rows={CROSS} scale={2} />
      </button>
    </span>
  );
}

const SHOWN_DAYS = 7;
/** How far the arrows move the strip: a week. A trackpad's side scroll moves it a day at a time. */
const STEP_DAYS = 7;
/** Rest after the last scroll before the strip springs onto the nearest day, ms. */
const SETTLE_MS = 120;
const daysFrom = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

// drawn at 2 px a cell
const CROSS = ["# #", " # ", "# #"];
const LEFT = ["  #", " ##", "###", " ##", "  #"];
const RIGHT = ["#  ", "## ", "###", "## ", "#  "];
// at 1 px a cell, beside the switch's label
const CALENDAR = ["  #    #  ", "##########", "##########", "#oooooooo#", "#o##o##oo#", "#oooooooo#", "#o##o##oo#", "#oooooooo#", "##########"];

const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const addMonths = (ym: string, n: number) => {
  const d = new Date(`${ym}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * A month of days, Monday first, for picking a date further off than the strip's week. The picked day is a solid pixel
 * block; today has a pixel dot; days before `min` can't be picked. With `from`, the stretch from that day to the one
 * picked is drawn as a dashed route, as the trip will be on the globe. Arrow keys move a day or a week, Page Up and
 * Page Down a month.
 */
function MonthGrid({ min, value, from, label, onPick }: { min: string; value: string | null; from?: string; label: string; onPick: (iso: string) => void }) {
  const [focus, setFocus] = useState(() => (value && value >= min ? value : min));
  const month = focus.slice(0, 7);
  const grid = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const today = localIso(new Date());
  // a keyboard move takes focus with it; opening, or the month arrows, leave it where it is
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus]);
  const go = (iso: string, keyboard = true) => {
    moved.current = keyboard;
    setFocus(iso < min ? min : iso);
  };
  const lead = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  const count = daysFrom(`${month}-01`, `${addMonths(month, 1)}-01`);
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: count }, (_, i) => addDays(`${month}-01`, i))];
  return (
    <div className="ts-cal">
      <div className="ts-cal-head">
        <button type="button" className="ts-strip-step" aria-label="Previous month" disabled={month <= min.slice(0, 7)} onClick={() => go(`${addMonths(month, -1)}-01`, false)}>
          <PixelIcon rows={LEFT} scale={2} />
        </button>
        <span className="ts-cal-month" aria-live="polite">
          {monthLabel(month)}
        </span>
        <button type="button" className="ts-strip-step" aria-label="Next month" onClick={() => go(`${addMonths(month, 1)}-01`, false)}>
          <PixelIcon rows={RIGHT} scale={2} />
        </button>
      </div>
      <div
        ref={grid}
        className="ts-cal-grid"
        role="group"
        aria-label={label}
        onKeyDown={(e) => {
          const by: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
          if (e.key in by) go(addDays(focus, by[e.key]));
          else if (e.key === "PageUp" || e.key === "PageDown") {
            const next = `${addMonths(month, e.key === "PageUp" ? -1 : 1)}-${focus.slice(8)}`;
            go(Number.isNaN(Date.parse(next)) ? `${addMonths(month, e.key === "PageUp" ? -1 : 1)}-01` : next);
          } else if (e.key === "Home") go(addDays(focus, -((new Date(`${focus}T00:00:00Z`).getUTCDay() + 6) % 7)));
          else if (e.key === "End") go(addDays(focus, 6 - ((new Date(`${focus}T00:00:00Z`).getUTCDay() + 6) % 7)));
          else return;
          e.preventDefault();
        }}
      >
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="ts-cal-weekday" aria-hidden>
            {d}
          </span>
        ))}
        {cells.map((iso, i) =>
          iso ? (
            <button
              key={iso}
              type="button"
              className="ts-cal-day"
              data-day={iso}
              data-today={iso === today || undefined}
              data-start={(from && iso === from) || undefined}
              aria-label={dateLabel(iso)}
              aria-pressed={iso === value}
              aria-current={iso === today ? "date" : undefined}
              disabled={iso < min}
              tabIndex={iso === focus ? 0 : -1}
              onClick={() => onPick(iso)}
            >
              {Number(iso.slice(8))}
            </button>
          ) : (
            <span key={`pad${i}`} aria-hidden />
          ),
        )}
      </div>
    </div>
  );
}

/**
 * A week of days from `start` (the earliest pickable), with `value` filled in ink. The arrows move it a few days at a
 * time, never before `start`; the calendar button swaps the week for a month to pick from. `from` is the start of
 * the stretch being picked (the departure, when picking a return), drawn across the month as a dashed route.
 */
export function DayStrip({
  start,
  value,
  label,
  from,
  onPick,
  children,
}: {
  start: string;
  value: string | null;
  label: string;
  from?: string;
  onPick: (iso: string) => void;
  /** Shown at the start of the footer, opposite the week and month switch: e.g. "Keep one way". */
  children?: ReactNode;
}) {
  // how many days past `start` the strip begins; a value off the strip brings it into view
  const into = (iso: string | null) => (iso ? Math.max(0, daysFrom(start, iso) - (SHOWN_DAYS - 1)) : 0);
  const [shift, setShift] = useState(() => into(value));
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    const at = value ? daysFrom(start, value) : -1;
    if (value && (at < shift || at >= shift + SHOWN_DAYS)) setShift(Math.max(0, at - 3));
  }
  const [month, setMonth] = useState(false);
  const first = addDays(start, shift);

  // A trackpad's side scroll slides the days like a revolver's chamber: the strip follows the fingers, a day ticks
  // over each time one passes, and once the scroll rests it springs onto the nearest day. A hard flick's momentum
  // carries it on a few days.
  const strip = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(0);
  const [settling, setSettling] = useState(false);
  const dragRef = useRef(0);
  const shiftRef = useRef(shift);
  useEffect(() => {
    shiftRef.current = shift;
  });
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    let timer = 0;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      const cell = el.clientWidth / SHOWN_DAYS || 1;
      let next = dragRef.current + e.deltaX;
      // nothing before the earliest day
      if (shiftRef.current === 0 && next < 0) next = 0;
      const whole = Math.trunc(next / cell);
      if (whole) {
        const to = Math.max(0, shiftRef.current + whole);
        next -= (to - shiftRef.current) * cell;
        shiftRef.current = to;
        setShift(to);
        if (to === 0 && next < 0) next = 0;
      }
      dragRef.current = next;
      setSettling(false);
      setDrag(next);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // the snap: past halfway goes on to the next day, else back
        const over = Math.abs(dragRef.current) > cell / 2 ? Math.sign(dragRef.current) : 0;
        if (over) {
          const to = Math.max(0, shiftRef.current + over);
          shiftRef.current = to;
          setShift(to);
        }
        dragRef.current = 0;
        setSettling(true);
        setDrag(0);
      }, SETTLE_MS);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(timer);
    };
  }, [month]);
  // under the days, so the week and the month both take the full width
  const foot = (
    <div className="ts-strip-foot">
      {children}
      <button type="button" className="ts-strip-mode" aria-pressed={month} onClick={() => setMonth((m) => !m)}>
        <PixelIcon rows={CALENDAR} />
        {month ? "Week" : "Month"}
      </button>
    </div>
  );
  if (month) {
    return (
      <div className="ts-strip-wrap">
        <MonthGrid min={start} value={value} from={from} label={label} onPick={onPick} />
        {foot}
      </div>
    );
  }
  return (
    <div className="ts-strip-wrap">
    <div className="ts-strip-row">
      <button type="button" className="ts-strip-step" aria-label="Earlier days" disabled={shift === 0} onClick={() => setShift((s) => Math.max(0, s - STEP_DAYS))}>
        <PixelIcon rows={LEFT} scale={2} />
      </button>
      <div
        ref={strip}
        className="ts-strip"
        role="group"
        aria-label={label}
        data-settling={settling || undefined}
        style={drag ? { transform: `translateX(${-drag}px)` } : undefined}
        onTransitionEnd={() => setSettling(false)}
      >
        {Array.from({ length: SHOWN_DAYS }, (_, i) => addDays(first, i)).map((iso) => {
          const p = dayParts(iso);
          return (
            <button
              key={iso}
              type="button"
              className="ts-day"
              aria-label={dateLabel(iso)}
              aria-pressed={iso === value}
              onClick={() => onPick(iso)}
            >
              <span className="ts-day-weekday">{p.weekday}</span>
              <span className="ts-day-number">{p.day}</span>
            </button>
          );
        })}
      </div>
      <button type="button" className="ts-strip-step" aria-label="Later days" onClick={() => setShift((s) => s + STEP_DAYS)}>
        <PixelIcon rows={RIGHT} scale={2} />
      </button>
    </div>
    {foot}
    </div>
  );
}

/**
 * Moving legs as a line with the vehicle at its head, travelling right (a dashed trail for a flight, a track for the
 * rest), layovers as a dotted line, each as wide as its minutes. With a `clock`, it leaves at the left end's time and
 * gets in at the right's; a worked-out arrival reads "~19:40".
 */
export function Timeline({ legs, clock = null }: { legs: TimelineLeg[]; clock?: Clock | null }) {
  return (
    <span className="ts-timeline">
      {clock ? (
        <span className="ts-time" title="Leaves">
          {clock.departs}
        </span>
      ) : null}
      <span className="ts-track" aria-hidden>
        {legs.map((leg, i) => (
          <span
            key={i}
            title={leg.label}
            className={leg.kind === "wait" ? "ts-seg ts-seg-wait" : "ts-seg"}
            style={{ flexGrow: Math.max(1, leg.minutes) }}
          >
            {leg.kind === "wait" ? (
              <span className="ts-dots" />
            ) : leg.kind === "flight" ? (
              <>
                <span className="ts-trail" />
                <Glyph kind="flight" />
              </>
            ) : (
              <>
                <span className="ts-bar" />
                {leg.kind === "train" ? <RailGlyph size={15} /> : <Glyph kind={leg.kind} size={13} />}
              </>
            )}
          </span>
        ))}
      </span>
      {clock?.arrives ? (
        <span className="ts-time ts-time-end" title={clock.approx ? "Arrives, worked out from the duration" : "Arrives"}>
          {clock.approx ? "~" : null}
          {clock.arrives}
          {clock.days !== 0 ? <sup>{clock.days > 0 ? `+${clock.days}` : clock.days}</sup> : null}
        </span>
      ) : null}
    </span>
  );
}
