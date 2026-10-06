"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { End } from "@/lib/liveblocks/types";
import { distanceKm, type Coordinates } from "@/lib/transport/hubs/geo";
import { hubChoices } from "@/lib/transport/hubs/pick";
import type { Hub } from "@/lib/transport/hubs/types";
import { regionName } from "@/lib/places/place";

import { Glyph } from "./glyphs";

// Picking the airport, station or ferry terminal a route leaves from or gets to. It opens under the route header in
// the card, like the date strip under the dates. Styles: ticket-search.css.

/** Station codes like "HK-WEST-KOWLOON" are catalogue ids, not something to print. */
const IATA = /^[A-Z]{3}$/;
/** What each end's hub is, as the picker and its chip are named. */
export const END_LABEL: Record<End, string> = { from: "Leave from", to: "Arrive at" };
const SEARCH = (
  <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden className="ts-hub-glyph">
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.4 10.4 14 14" />
  </svg>
);

/** A hub's mark: its airport code, or its mode's glyph. */
function HubMark({ hub }: { hub: Hub | null }) {
  if (!hub) return SEARCH;
  if (hub.mode === "flight" && IATA.test(hub.code)) return <>{hub.code}</>;
  return <Glyph kind={hub.mode} size={12} />;
}

/**
 * One end's hub under its city in the route header: the stop's airport code, else its hub's mark. Solid once snapped
 * (the search uses exactly that hub), dashed while it's only the nearest one (the search looks around it).
 */
export function HubChip({ hub, code, snapped, open, end, onToggle }: {
  hub: Hub | null;
  /** The code the stop shows, which can differ from its preview hub's in older rooms. */
  code?: string | null;
  snapped: boolean;
  open: boolean;
  end: End;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="ts-hub-chip"
      data-snapped={snapped || undefined}
      aria-expanded={open}
      aria-label={`${END_LABEL[end]}: ${hub ? hub.name : "nearby"}${hub && !snapped ? " or nearby" : ""}`}
      title={hub?.name}
      onClick={onToggle}
    >
      {code && IATA.test(code) ? code : <HubMark hub={hub} />}
    </button>
  );
}

/**
 * The hubs to pick from for one end: with nothing typed, those near `near` that a search would consider; typed, any
 * whose code, name or city matches. "All nearby" lets go of a snapped hub, so the search looks around the place again.
 */
export function HubPicker({ near, current, snapped, end, onPick, onClose }: {
  near: Coordinates;
  current: Hub | null;
  snapped: boolean;
  end: End;
  /** A hub to snap to, or null for all nearby. */
  onPick: (hub: Hub | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const hubs = useMemo(() => hubChoices(query, near), [query, near]);
  // letting go comes first while snapped and nothing's typed
  const options: (Hub | null)[] = snapped && !query.trim() ? [null, ...hubs] : hubs;

  useEffect(() => {
    input.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      // the card closes on Escape too; this one's for the picker
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!options.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (options.length) onPick(options[Math.min(active, options.length - 1)]);
    }
  };

  const label = END_LABEL[end];
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const km = (hub: Hub) => Math.round(distanceKm(near, hub));
  return (
    <div className="ts-hubs">
      <label className="ts-field ts-hub-field">
        {SEARCH}
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-label={label}
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={options.length ? optionId(Math.min(active, options.length - 1)) : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Airport or station"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      {options.length ? (
        <ul id={listId} className="ts-hub-list" role="listbox" aria-label={label}>
          {options.map((hub, i) => (
            <li
              key={hub?.id ?? "nearby"}
              id={optionId(i)}
              role="option"
              aria-selected={i === Math.min(active, options.length - 1)}
              data-current={(snapped && hub?.id === current?.id) || undefined}
              className="ts-hub-option"
              onPointerMove={() => setActive(i)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => onPick(hub)}
            >
              <span className="ts-hub-mark" aria-hidden>
                <HubMark hub={hub} />
              </span>
              <span className="ts-hub-text">
                <span className="ts-hub-name">{hub ? hub.name : "All nearby"}</span>
                {hub ? (
                  <span className="ts-hub-detail">
                    {[hub.city !== hub.name ? hub.city : null, regionName(hub.country ?? ""), km(hub) >= 1 ? `${km(hub).toLocaleString("en-US")} km` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ts-empty">No airport or station by that name.</p>
      )}
    </div>
  );
}
