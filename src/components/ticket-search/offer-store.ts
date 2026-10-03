import { recordTiming } from "@/lib/performance";
import type { HubSearchResult } from "@/lib/transport/hub-search";
import type { TransportSearchEvent } from "@/lib/transport/stream";

export type SearchSnapshot = { status: "searching" | "done" | "failed"; result: HubSearchResult | null };
type Entry = { value: SearchSnapshot; until: number; controller: AbortController; listeners: Set<(s: SearchSnapshot) => void> };
const EMPTY: SearchSnapshot = { status: "searching", result: null };

/** Bounded, in-memory reuse only. Live offers are revalidated by booking, never treated as purchase authority. */
export class OfferStore {
  private entries = new Map<string, Entry>();
  constructor(private request: (url: string, signal: AbortSignal, publish: (value: SearchSnapshot) => void) => Promise<void> = readOffers) {}
  peek(key: string): SearchSnapshot | null {
    const entry = this.entries.get(key);
    return entry && (entry.value.status === "searching" || entry.until > Date.now()) ? entry.value : null;
  }
  watch(key: string, listener: (value: SearchSnapshot) => void, refresh = false) {
    let entry = this.entries.get(key);
    if (refresh || !entry || (entry.value.status !== "searching" && entry.until <= Date.now())) {
      entry?.controller.abort();
      entry ??= { value: EMPTY, until: 0, controller: new AbortController(), listeners: new Set() };
      entry.value = EMPTY;
      entry.until = 0;
      entry.controller = new AbortController();
      this.entries.set(key, entry);
      const current = entry;
      const controller = current.controller;
      const started = performance.now();
      let first = true;
      const publish = (value: SearchSnapshot) => {
        if (controller.signal.aborted) return;
        current.value = value;
        // Offer has no expiry field: completed live quotes must be searched again on remount.
        current.until = value.status === "done" && !value.result?.offers.some((o) => o.kind === "live") ? Date.now() + 60_000 : 0;
        if (first && value.result?.offers.length) { first = false; recordTiming("fare-first", started); }
        if (value.status === "done") recordTiming("fare-complete", started);
        for (const notify of current.listeners) notify(value);
      };
      void this.request(`/api/transport/search?${key}&stream=1`, controller.signal, publish)
        .catch(() => publish({ status: "failed", result: current.value.result }));
      // Evict only inactive entries, so a mounted search cannot disappear under another subscriber.
      for (const [id, old] of this.entries) {
        if (this.entries.size <= 32) break;
        if (!old.listeners.size && id !== key) { old.controller.abort(); this.entries.delete(id); }
      }
    }
    entry.listeners.add(listener);
    listener(entry.value);
    const current = entry;
    return () => {
      current.listeners.delete(listener);
      // Strict Effects and same-turn remounts can reuse the request before its last observer leaves.
      queueMicrotask(() => {
        if (!current.listeners.size && current.value.status === "searching") {
          current.controller.abort();
          if (this.entries.get(key) === current) this.entries.delete(key);
        }
      });
    };
  }
}

/** Stream complete snapshots; a dropped stream retains its usable partial results and exposes Retry. */
export async function readOffers(url: string, signal: AbortSignal, publish: (value: SearchSnapshot) => void) {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch(url, { signal });
      if (![502, 503, 504].includes(response.status) || attempt === 1) break;
    } catch (error) { if (signal.aborted || attempt === 1) throw error; }
  }
  if (!response?.ok) throw new Error("Search failed");
  if (!response.headers.get("content-type")?.includes("ndjson")) {
    publish({ status: "done", result: await response.json() as HubSearchResult });
    return;
  }
  if (!response.body) throw new Error("Missing search stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  const line = (raw: string) => {
    if (!raw.trim()) return;
    const event = JSON.parse(raw) as TransportSearchEvent;
    if (event.t === "failed") throw new Error("Search failed");
    finished = event.done;
    publish({ status: event.done ? "done" : "searching", result: event.result });
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) { line(buffer.slice(0, at)); buffer = buffer.slice(at + 1); }
    }
    buffer += decoder.decode();
    line(buffer);
    if (!finished) throw new Error("Search interrupted");
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export const offerStore = new OfferStore();
