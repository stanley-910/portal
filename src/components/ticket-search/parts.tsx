"use client";

import type { Mode } from "@/lib/transport/types";

import { Glyph } from "./glyphs";
import type { TimelineLeg } from "./options";

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

/** "Sun 4 Oct" */
export const dateLabel = (iso: string) => {
  const p = dayParts(iso);
  return `${p.weekday} ${p.day} ${p.month}`;
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

/** City to city: names as the title, an airport code beneath when there is one, the route between, and the distance when known. */
export function RouteHeader({
  from,
  to,
  distanceKm,
  mode = null,
}: {
  from: { code?: string | null; name: string };
  to: { code?: string | null; name: string };
  distanceKm?: number;
  /** What's taking them, shown on the route. */
  mode?: Mode | null;
}) {
  return (
    <div className="ts-route">
      <span className="ts-place">
        <span className="ts-city">{cityName(from.name)}</span>
        {from.code && IATA.test(from.code) ? <span className="ts-code">{from.code}</span> : null}
      </span>
      <span className="ts-distance">
        <RouteArc mode={mode} />
        {distanceKm === undefined ? null : <span>{distanceKm.toLocaleString("en-US")} km</span>}
      </span>
      <span className="ts-place ts-place-end">
        <span className="ts-city">{cityName(to.name)}</span>
        {to.code && IATA.test(to.code) ? <span className="ts-code">{to.code}</span> : null}
      </span>
    </div>
  );
}

/** A 52 px date button. With no value it shows `empty` in muted text. */
export function DateField({
  label,
  value,
  empty = "Add date",
  open,
  onToggle,
}: {
  label: string;
  value: string | null;
  empty?: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" className="ts-field" aria-expanded={open} onClick={onToggle}>
      <span className="ts-field-label">{label}</span>
      <span className="ts-field-value" data-empty={!value || undefined}>
        {value ? dateLabel(value) : empty}
      </span>
    </button>
  );
}

/** Seven days from `start`, with `value` filled in ink. */
export function DayStrip({
  start,
  value,
  label,
  onPick,
}: {
  start: string;
  value: string | null;
  label: string;
  onPick: (iso: string) => void;
}) {
  return (
    <div className="ts-strip" role="group" aria-label={label}>
      {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((iso) => {
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
  );
}

/** Moving legs as a mode icon and a bar, layovers as a dotted line, each as wide as its minutes. */
export function Timeline({ legs }: { legs: TimelineLeg[] }) {
  return (
    <span className="ts-timeline" aria-hidden>
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
              <Glyph kind={leg.kind} size={13} />
              <span className="ts-bar" />
            </>
          )}
        </span>
      ))}
    </span>
  );
}
