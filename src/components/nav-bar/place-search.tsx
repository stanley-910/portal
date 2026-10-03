"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject, type CSSProperties } from "react";

import { addDays, dateLabel, localIso, MonthGrid } from "@/components/ticket-search/parts";
import type { TripGlobeHandle } from "@/components/trip-globe";
import { mergePlaces, searchPlaces, type PlaceKind, type PlaceResult } from "@/lib/places/search";

const SEARCH_GLYPH = (
  <>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.4 10.4 14 14" />
  </>
);

const KIND_GLYPHS: Record<Exclude<PlaceKind, "region">, ReactNode> = {
  airport: <path d="M14 8 2.5 3.5 4.5 8l-2 4.5L14 8ZM4.5 8H9" />,
  city: (
    <>
      <path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14Z" />
      <circle cx="8" cy="6.5" r="1.5" />
    </>
  ),
  station: (
    <>
      <path d="M5 2.5h6a1.5 1.5 0 0 1 1.5 1.5v5.5a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2V4A1.5 1.5 0 0 1 5 2.5Z" />
      <path d="M3.5 7h9M6 11.5l-1.5 2M10 11.5l1.5 2" />
    </>
  ),
  country: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c-2.2 2.4-2.2 9.6 0 12M8 2c2.2 2.4 2.2 9.6 0 12" />
    </>
  ),
};

const KIND_LABELS: Record<PlaceKind, string> = { country: "Country", region: "Region", city: "City", airport: "Airport", station: "Station" };
/** How long the panel takes to fold back into its button. */
const CLOSE_MS = 160;
const ONLINE_MIN = 3;
const ONLINE_DELAY_MS = 250;

/** Places from the online geocoder for `query`, debounced. Failures count as none: bundled results still show. */
function useOnlinePlaces(query: string) {
  const q = query.trim();
  const [found, setFound] = useState<{ q: string; places: PlaceResult[] }>({ q: "", places: [] });
  useEffect(() => {
    if (q.length < ONLINE_MIN) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/places?${new URLSearchParams({ q })}`, { signal: controller.signal })
        .then(async (response) => (response.ok ? ((await response.json()) as { places: PlaceResult[] }).places : []))
        .catch(() => [] as PlaceResult[])
        .then((places) => {
          if (!controller.signal.aborted) setFound({ q, places });
        });
    }, ONLINE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);
  const current = q.length >= ONLINE_MIN && found.q === q;
  return { places: current ? found.places : [], pending: q.length >= ONLINE_MIN && !current };
}

type End = "from" | "to";
const OTHER: Record<End, End> = { from: "to", to: "from" };

export interface PlaceSearchProps {
  globe: RefObject<TripGlobeHandle | null>;
  /**
   * Makes it a From and To search with a date between them, where picking both puts the trip down (draws its route on
   * the globe). Without it, it's one field that turns the globe to a place.
   */
  onRoute?: (from: PlaceResult, to: PlaceResult, date: string) => void;
}

/**
 * A search in the NavBar that turns the globe to a city, airport, station or country. With `onRoute` it's a From and
 * To search: one place picked turns the globe to it, the second puts the route down on the date between them. `/`
 * opens it.
 */
export function PlaceSearch({ globe, onRoute }: PlaceSearchProps) {
  const route = !!onRoute;
  const [open, setOpen] = useState(false);
  // folding back into the button: the panel stays for its closing animation, then goes
  const [closing, setClosing] = useState(false);
  const [field, setField] = useState<End>("from");
  const [queries, setQueries] = useState<Record<End, string>>({ from: "", to: "" });
  const [picked, setPicked] = useState<Record<End, PlaceResult | null>>({ from: null, to: null });
  const [date, setDate] = useState(() => addDays(localIso(new Date()), 1));
  const [calendar, setCalendar] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const fromInput = useRef<HTMLInputElement>(null);
  const toInput = useRef<HTMLInputElement>(null);
  const inputs: Record<End, RefObject<HTMLInputElement | null>> = { from: fromInput, to: toInput };
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId();
  // the field being typed in lists places; one showing what was picked in it lists none until it's typed in again
  const query = picked[field] ? "" : queries[field];
  const local = useMemo(() => searchPlaces(query), [query]);
  const online = useOnlinePlaces(query);
  const results = useMemo(() => mergePlaces(local, online.places), [local, online.places]);

  const reset = () => {
    setQueries({ from: "", to: "" });
    setPicked({ from: null, to: null });
    setField("from");
    setCalendar(false);
    setActive(0);
  };
  // opening again mid-close keeps it open
  const show = () => {
    // reopened while folding away: start fresh, as a closed search would
    if (closing) reset();
    setClosing(false);
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setClosing(true);
    if (refocus) toggle.current?.focus();
  };
  useEffect(() => {
    if (!closing) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      setQueries({ from: "", to: "" });
      setPicked({ from: null, to: null });
      setField("from");
      setCalendar(false);
      setActive(0);
    }, still ? 0 : CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);

  /** Turns the globe to a place. A city, airport or station is marked and named where it is; a country or region already has its name on the map. */
  const flyTo = (place: PlaceResult) => {
    const mark = place.kind === "country" || place.kind === "region" ? undefined : place.name;
    globe.current?.flyTo({ lat: place.lat, lng: place.lng }, place.spanDeg, mark);
  };

  const pick = (place: PlaceResult) => {
    if (!onRoute) {
      flyTo(place);
      // focus goes back to the button rather than dropping to the page as the panel folds away
      return close(true);
    }
    const both = { ...picked, [field]: place };
    setPicked(both);
    setQueries((q) => ({ ...q, [field]: place.name }));
    setActive(0);
    const other = both[OTHER[field]];
    if (other) {
      const [from, to] = field === "from" ? [place, other] : [other, place];
      onRoute(from, to, date);
      return close(true);
    }
    // one end: the globe turns to it, and the other end is next
    flyTo(place);
    setField(OTHER[field]);
    inputs[OTHER[field]].current?.focus();
  };

  /** Search: both ends put the route down; one turns the globe to it. */
  const go = () => {
    const { from, to } = picked;
    if (from && to && onRoute) {
      onRoute(from, to, date);
      close(true);
    } else if (from ?? to) {
      flyTo((from ?? to)!);
      close(true);
    }
  };

  useEffect(() => {
    if (open && !closing) fromInput.current?.focus();
  }, [open, closing]);

  // the shortcut listens once; it calls whichever `show` is current, which knows whether the panel is closing
  const showNow = useRef(show);
  useLayoutEffect(() => {
    showNow.current = show;
  });
  useEffect(() => {
    const slash = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      showNow.current();
    };
    document.addEventListener("keydown", slash);
    return () => document.removeEventListener("keydown", slash);
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      setClosing(true);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!results.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const place = results[active] ?? results[0];
      if (place) pick(place);
      // Enter on text that hasn't found anything yet waits for it, rather than going without it
      else if (!queries[field].trim() || picked[field]) go();
    }
  };

  // the calendar takes focus as it opens, on the day picked, so it's reachable from the keyboard
  const dateButton = useRef<HTMLButtonElement>(null);
  const cal = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (calendar) cal.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  }, [calendar]);
  // Escape anywhere in the panel: the calendar first, then the panel. The fields handle their own.
  const onPanelKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    if (calendar) {
      setCalendar(false);
      dateButton.current?.focus();
    } else close(true);
  };

  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const showList = open && !calendar && results.length > 0;
  const waiting = open && !calendar && !results.length && online.pending;

  const input = (end: End, placeholder: string, label: string) => (
    <input
      ref={inputs[end]}
      type="search"
      role="combobox"
      aria-label={label}
      aria-expanded={showList && field === end}
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={showList && field === end ? optionId(active) : undefined}
      autoComplete="off"
      spellCheck={false}
      placeholder={placeholder}
      data-picked={picked[end] ? "" : undefined}
      value={queries[end]}
      onFocus={(e) => {
        setField(end);
        setCalendar(false);
        setActive(0);
        // a picked place reads as one thing: selecting it all lets typing replace it
        if (picked[end]) e.currentTarget.select();
      }}
      onChange={(event) => {
        const text = event.target.value;
        setQueries((q) => ({ ...q, [end]: text }));
        setPicked((p) => (p[end] ? { ...p, [end]: null } : p));
        setActive(0);
      }}
      onKeyDown={onKeyDown}
    />
  );

  return (
    <div ref={root} className="pn-search" data-route={route || undefined}>
      <button ref={toggle} type="button" className="pa-round" aria-label="Find a place" title="Find a place"
        aria-expanded={open && !closing} onClick={show}>
        <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>{SEARCH_GLYPH}</svg>
      </button>
      {open ? (
        <div data-globe-obstacle className="pn-search-panel" data-closing={closing || undefined} onKeyDown={onPanelKey}>
          {route ? (
            <div className="pn-search-field pn-route" role="group" aria-label="Find a route">
              <span className="pn-route-end" data-active={field === "from" || undefined}>
                <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden>
                  <circle cx="8" cy="8" r="4" />
                </svg>
                {input("from", "From", "From")}
              </span>
              <button
                ref={dateButton}
                type="button"
                className="pn-route-date"
                aria-label={`Date, ${dateLabel(date)}`}
                aria-expanded={calendar}
                onClick={() => setCalendar((c) => !c)}
              >
                {dateLabel(date)}
              </button>
              <span className="pn-route-end" data-active={field === "to" || undefined}>
                <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden>
                  <path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14Z" />
                  <circle cx="8" cy="6.5" r="1.5" />
                </svg>
                {input("to", "To", "To")}
              </span>
              <button type="button" className="pn-route-go" aria-label="Search" title="Search" disabled={!picked.from && !picked.to} onClick={go}>
                <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>{SEARCH_GLYPH}</svg>
              </button>
            </div>
          ) : (
            <label className="pn-search-field">
              <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>{SEARCH_GLYPH}</svg>
              {input("from", "Find a city, airport or station", "Find a place")}
            </label>
          )}
          {calendar ? (
            <div ref={cal} className="pn-menu pn-route-cal">
              <MonthGrid
                min={localIso(new Date())}
                value={date}
                label="Travel date"
                onPick={(iso) => {
                  setDate(iso);
                  setCalendar(false);
                  // on to whichever end is still empty
                  const next: End = !picked.from ? "from" : "to";
                  setField(next);
                  inputs[next].current?.focus();
                }}
              />
            </div>
          ) : null}
          {showList ? (
            <ul id={listId} className="pn-menu pn-search-list" role="listbox" aria-label="Places" data-end={route ? field : undefined}>
              {results.map((place, i) => (
                <li
                  key={place.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className="pn-search-option"
                  style={{ "--i": Math.min(i, 8) } as CSSProperties}
                  onPointerMove={() => setActive(i)}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => pick(place)}
                >
                  <span className="pn-menu-symbol" aria-hidden>
                    {place.kind === "airport" && place.code ? place.code : (
                      <svg width={16} height={16} viewBox="0 0 16 16">{KIND_GLYPHS[place.kind === "region" ? "country" : place.kind]}</svg>
                    )}
                  </span>
                  <span className="pn-menu-text">
                    <span>{place.name}</span>
                    <span className="pn-menu-detail">{[place.label ?? KIND_LABELS[place.kind], place.detail].filter(Boolean).join(", ")}</span>
                  </span>
                </li>
              ))}
              {results.some((place) => place.source === "osm") ? (
                <li role="presentation" className="pn-search-credit">© OpenStreetMap contributors</li>
              ) : null}
            </ul>
          ) : null}
          {waiting ? (
            <div className="pn-menu pn-search-list pn-search-wait">
              <div className="pa-dots" role="status" aria-label="Searching">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
