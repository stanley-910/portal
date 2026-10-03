"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";

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

/** A search field in the NavBar that turns the globe to a city, airport, station or country. `/` opens it. */
export function PlaceSearch({ globe }: { globe: RefObject<TripGlobeHandle | null> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId();
  const local = useMemo(() => searchPlaces(query), [query]);
  const online = useOnlinePlaces(query);
  const results = useMemo(() => mergePlaces(local, online.places), [local, online.places]);

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery("");
    setActive(0);
    if (refocus) toggle.current?.focus();
  };

  const pick = (place: PlaceResult) => {
    globe.current?.flyTo({ lat: place.lat, lng: place.lng }, place.spanDeg);
    close(false);
  };

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  useEffect(() => {
    const slash = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener("keydown", slash);
    return () => document.removeEventListener("keydown", slash);
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      setOpen(false);
      setQuery("");
      setActive(0);
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
    }
  };

  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const showList = open && results.length > 0;
  const waiting = open && !results.length && online.pending;

  return (
    <div ref={root} className="pn-search">
      <button ref={toggle} type="button" className="pa-round" aria-label="Find a place" title="Find a place"
        aria-expanded={open} onClick={() => setOpen(true)}>
        <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>{SEARCH_GLYPH}</svg>
      </button>
      {open ? (
        <div className="pn-search-panel">
          <label className="pn-search-field">
            <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>{SEARCH_GLYPH}</svg>
            <input
              ref={input}
              type="search"
              role="combobox"
              aria-label="Find a place"
              aria-expanded={showList}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={showList ? optionId(active) : undefined}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </label>
          {showList ? (
            <ul id={listId} className="pn-menu pn-search-list" role="listbox" aria-label="Places">
              {results.map((place, i) => (
                <li
                  key={place.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className="pn-search-option"
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
