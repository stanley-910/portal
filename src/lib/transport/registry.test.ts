import { describe, expect, it } from "vitest";
import { providers } from "./registry";
import { ProviderFailure, type Mode, type ProviderId, type SearchQuery } from "./types";

// Record forces a compile error when a ProviderId is added without updating this list.
const ALL_IDS: Record<ProviderId, true> = {
  travelpayouts: true,
  "12go": true,
  "official-ferries": true,
  tdx: true,
  "korea-tago": true,
  "china-rail": true,
  busonlineticket: true,
  gtfs: true,
  srt: true,
  duffel: true,
  "vietnam-rail": true,
  "rail-cache": true,
};

// Providers whose adapter task has replaced the stub; their own tests cover search/covers.
const LANDED = new Set<ProviderId>(["gtfs", "china-rail", "tdx", "busonlineticket", "korea-tago", "12go", "srt", "travelpayouts", "duffel", "vietnam-rail", "official-ferries", "rail-cache"]);
const stubs = providers.filter((p) => !LANDED.has(p.id));

const place = { name: "X", lat: 0, lng: 0 };
const query = (modes: Mode[]): SearchQuery => ({
  from: place,
  to: place,
  date: "2026-10-10",
  modes,
  passengers: 1,
  currency: "USD",
});

describe("registry", () => {
  it("registers every ProviderId exactly once", () => {
    const ids = providers.map((p) => p.id).sort();
    expect(ids).toEqual(Object.keys(ALL_IDS).sort());
  });

  it("every provider declares at least one mode", () => {
    for (const p of providers) expect(p.modes.length, p.id).toBeGreaterThan(0);
  });

  it.each(stubs.map((p) => [p.id, p] as const))("stub %s rejects with NOT_CONFIGURED", async (_id, p) => {
    const err = await p.search(query([]), AbortSignal.timeout(1_000)).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ProviderFailure);
    expect((err as ProviderFailure).code).toBe("NOT_CONFIGURED");
  });

  it.each(stubs.map((p) => [p.id, p] as const))("stub %s covers only its own modes", (_id, p) => {
    expect(p.covers(query([]))).toBe(true);
    expect(p.covers(query([p.modes[0]]))).toBe(true);
    const other = (["flight", "train", "bus", "ferry"] as const).filter((m) => !p.modes.includes(m));
    if (other.length) expect(p.covers(query(other))).toBe(false);
  });
});
