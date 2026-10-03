"use client";

import { useEffect, useState } from "react";

import type { LatLng } from "@/components/trip-globe";
import { clickSearchParams } from "@/lib/transport/client-query";
import type { HubSearchResult } from "@/lib/transport/hub-search";
import type { Offer } from "@/lib/transport/types";

export type OfferSearch =
  | { status: "idle" | "searching" | "failed"; offers: Offer[]; result: null }
  | { status: "done"; offers: Offer[]; result: HubSearchResult };

/** After this long a search still running is "still looking": a slow provider, not a failure. */
export const SLOW_SEARCH_MS = 4_000;

/** Answers worth one quiet retry: the connection dropped, or the server or platform gave up. */
const retryable = (status: number) => status === 502 || status === 503 || status === 504;

/**
 * Searches every mode between two clicked points on a date (YYYY-MM-DD). The server resolves the nearby hubs
 * (`resolve=hubs`); preview hubs never replace the points. Pass a null date to skip. A newer search cancels the
 * one in flight, so a slow answer for an old date never replaces a newer one, and a cancelled search never reads as
 * failed. A search that drops its connection is tried once more before it fails. `slow` turns on while a search runs
 * past `SLOW_SEARCH_MS`. `retry` runs it again.
 */
export function useOffers(from: LatLng, to: LatLng, date: string | null): OfferSearch & { slow: boolean; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  // results are stored with the search they answer, so a changed date reads as searching until its answer lands
  const key = date ? `${from.lat},${from.lng}|${to.lat},${to.lng}|${date}|${attempt}` : null;
  const [stored, setStored] = useState<{ key: string; search: OfferSearch } | null>(null);
  const [slowKey, setSlowKey] = useState<string | null>(null);
  // the search depends on the points' values, never on their objects: a parent re-render that passes equal points
  // must not cancel the search in flight and start it over
  const { lat: fromLat, lng: fromLng } = from;
  const { lat: toLat, lng: toLng } = to;

  useEffect(() => {
    if (!key || !date) return;
    const ctrl = new AbortController();
    const slow = window.setTimeout(() => setSlowKey(key), SLOW_SEARCH_MS);
    // noon local time keeps the chosen calendar day whatever the time zone
    const params = clickSearchParams({
      origin: { lat: fromLat, lng: fromLng },
      destination: { lat: toLat, lng: toLng },
      departDate: new Date(`${date}T12:00:00`),
    });
    const run = async (tries: number): Promise<HubSearchResult> => {
      let response: Response;
      try {
        response = await fetch(`/api/transport/search?${params}`, { signal: ctrl.signal });
      } catch (error) {
        if (ctrl.signal.aborted || tries <= 0) throw error;
        return run(tries - 1);
      }
      if (!response.ok && retryable(response.status) && tries > 0) return run(tries - 1);
      if (!response.ok) throw new Error("search failed");
      return (await response.json()) as HubSearchResult;
    };
    run(1)
      .then((result) => {
        if (!ctrl.signal.aborted) setStored({ key, search: { status: "done", offers: result.offers, result } });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setStored({ key, search: { status: "failed", offers: [], result: null } });
      })
      .finally(() => window.clearTimeout(slow));
    return () => {
      window.clearTimeout(slow);
      ctrl.abort();
    };
  }, [key, fromLat, fromLng, toLat, toLng, date]);

  const search: OfferSearch = !key
    ? { status: "idle", offers: [], result: null }
    : stored?.key === key
      ? stored.search
      : { status: "searching", offers: [], result: null };
  return { ...search, slow: search.status === "searching" && slowKey === key, retry: () => setAttempt((n) => n + 1) };
}
