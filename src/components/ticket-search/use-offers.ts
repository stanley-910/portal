"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clickSearchParams, type SearchEnd } from "@/lib/transport/client-query";
import type { HubSearchResult } from "@/lib/transport/hub-search";
import type { Offer } from "@/lib/transport/types";
import { offerStore, type SearchSnapshot } from "./offer-store";

export type OfferSearch = { status: "idle" | "searching" | "failed" | "done"; offers: Offer[]; result: HubSearchResult | null };
export const SLOW_SEARCH_MS = 4_000;

/** Exact query identity (a snapped end's hub included), shared in-flight work, and progressive usable results while slower providers finish. */
export function useOffers(from: SearchEnd, to: SearchEnd, date: string | null): OfferSearch & { slow: boolean; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const tried = useRef(0);
  const key = useMemo(() => date ? clickSearchParams({
    origin: { lat: from.lat, lng: from.lng, snap: from.snap }, destination: { lat: to.lat, lng: to.lng, snap: to.snap },
    departDate: new Date(`${date}T12:00:00`),
  }).toString() : null, [from.lat, from.lng, from.snap, to.lat, to.lng, to.snap, date]);
  const [stored, setStored] = useState<{ key: string; value: SearchSnapshot } | null>(null);
  const [slowKey, setSlowKey] = useState<string | null>(null);
  const searchKey = `${key}:${attempt}`;
  useEffect(() => {
    if (!key) return;
    const timer = window.setTimeout(() => setSlowKey(searchKey), SLOW_SEARCH_MS);
    const refresh = tried.current !== attempt;
    tried.current = attempt;
    const off = offerStore.watch(key, (value) => { setStored({ key, value }); if (value.status !== "searching") window.clearTimeout(timer); }, refresh);
    return () => { window.clearTimeout(timer); off(); };
  }, [key, attempt, searchKey]);
  const current = key ? (stored?.key === key ? stored.value : offerStore.peek(key)) : null;
  const status = !key ? "idle" : current?.status ?? "searching";
  return { status, result: current?.result ?? null, offers: current?.result?.offers ?? [], slow: status === "searching" && slowKey === searchKey, retry: () => setAttempt((n) => n + 1) };
}
