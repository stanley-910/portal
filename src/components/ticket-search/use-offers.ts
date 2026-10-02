"use client";

import { useEffect, useState } from "react";

import type { LatLng } from "@/components/trip-globe";
import { clickSearchParams } from "@/lib/transport/client-query";
import type { HubSearchResult } from "@/lib/transport/hub-search";
import type { Offer } from "@/lib/transport/types";

export type OfferSearch =
  | { status: "idle" | "searching" | "failed"; offers: Offer[]; result: null }
  | { status: "done"; offers: Offer[]; result: HubSearchResult };

/**
 * Searches every mode between two clicked points on a date (YYYY-MM-DD). The server resolves the nearby hubs
 * (`resolve=hubs`); preview hubs never replace the points. Pass a null date to skip. A newer search cancels the
 * one in flight, so a slow answer for an old date never replaces a newer one. `retry` runs it again.
 */
export function useOffers(from: LatLng, to: LatLng, date: string | null): OfferSearch & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  // results are stored with the search they answer, so a changed date reads as searching until its answer lands
  const key = date ? `${from.lat},${from.lng}|${to.lat},${to.lng}|${date}|${attempt}` : null;
  const [stored, setStored] = useState<{ key: string; search: OfferSearch } | null>(null);

  useEffect(() => {
    if (!key || !date) return;
    const ctrl = new AbortController();
    // noon local time keeps the chosen calendar day whatever the time zone
    const params = clickSearchParams({ origin: from, destination: to, departDate: new Date(`${date}T12:00:00`) });
    fetch(`/api/transport/search?${params}`, { signal: ctrl.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("search failed");
        const result = (await response.json()) as HubSearchResult;
        setStored({ key, search: { status: "done", offers: result.offers, result } });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setStored({ key, search: { status: "failed", offers: [], result: null } });
      });
    return () => ctrl.abort();
  }, [key, from, to, date]);

  const search: OfferSearch = !key
    ? { status: "idle", offers: [], result: null }
    : stored?.key === key
      ? stored.search
      : { status: "searching", offers: [], result: null };
  return { ...search, retry: () => setAttempt((n) => n + 1) };
}
