"use client";

import type { Mode } from "@/lib/transport/types";

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

export const ICON: Record<Mode, string> = {
  flight: "M8 1.8v12.4M2.2 9.2L8 6.6l5.8 2.6M5.6 14.2L8 13.2l2.4 1",
  train: "M4.5 2h7A1.5 1.5 0 0 1 13 3.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 10.5v-7A1.5 1.5 0 0 1 4.5 2zM3 7.5h10M5.5 14.5L6.8 12M10.5 14.5L9.2 12",
  bus: "M3.5 2.5h9a1 1 0 0 1 1 1V12h-11V3.5a1 1 0 0 1 1-1zM2.5 8h11M4.5 12v2M11.5 12v2",
  ferry: "M2 10.5h12l-1.8 3.5H3.8zM8 2v8.5M8 3.2l4 5.8H8",
};

/** Station codes like "HK-WEST-KOWLOON" are catalogue ids, not something to print. */
const IATA = /^[A-Z]{3}$/;
/** "Shanghai (Minhang)" → "Shanghai": airport data names the district, the card names the city. */
const cityName = (name: string) => name.replace(/\s*\([^)]*\)$/, "");

/** City to city: names as the title, an airport code beneath when there is one, and the distance when known. */
export function RouteHeader({
  from,
  to,
  distanceKm,
}: {
  from: { code?: string | null; name: string };
  to: { code?: string | null; name: string };
  distanceKm?: number;
}) {
  return (
    <div className="ts-route">
      <span className="ts-place">
        <span className="ts-city">{cityName(from.name)}</span>
        {from.code && IATA.test(from.code) ? <span className="ts-code">{from.code}</span> : null}
      </span>
      <span className="ts-distance">
        <span>{distanceKm === undefined ? "\u00a0" : `${distanceKm.toLocaleString("en-US")} km`}</span>
        <span className="ts-line" aria-hidden>
          <span />
          <span />
          <span />
        </span>
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
          ) : (
            <>
              <svg width={14} height={14} viewBox="0 0 16 16" className="ts-icon">
                <path d={ICON[leg.kind]} />
              </svg>
              <span className="ts-bar" />
            </>
          )}
        </span>
      ))}
    </span>
  );
}
