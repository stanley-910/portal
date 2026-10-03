import { describe, expect, it } from "vitest";
import provider from "./index";
import { ferrySeedSchema } from "./schema";
import seed from "./seed.json";
import hubs from "../../hubs/surface-hubs.json";
import { fanOut } from "../../search";
import { searchFromCoordinates } from "../../hub-search";
import { soloLegSchema } from "@/lib/trip/server";
import { rowsFor } from "@/components/ticket-search/options";
import type { SearchQuery } from "../../types";

const port = (code: string) => hubs.find((h) => h.id === `ferry:${code}`)!;
const q = (from: string, to: string, date = "2026-11-15"): SearchQuery => ({
  from: port(from), to: port(to), date, modes: ["ferry"], passengers: 1, currency: "USD",
});
const search = (query: SearchQuery) => provider.search(query, new AbortController().signal);

describe("official ferry snapshots", () => {
  it("validates sources and rejects malformed schedule fields", () => {
    expect(ferrySeedSchema.safeParse(seed).success).toBe(true);
    const withRoute = (field: object) => ({ ...seed, routes: [{ ...seed.routes[0], ...field }] });
    for (const change of [{ departures: ["24:00"] }, { weekdays: [7] }, { durationMin: -5 }, { source: "http://insecure.test" }]) {
      expect(ferrySeedSchema.safeParse(withRoute(change)).success).toBe(false);
    }
  });

  it("returns SG–Batam local times, no fabricated fare, and visible border/check-in source", async () => {
    const result = await fanOut(q("SG-HARBOURFRONT", "BATAM-CENTRE"), { providers: [provider] });
    expect(result.errors).toEqual([]);
    expect(result.offers[0]).toMatchObject({ kind: "timetable", provider: "official-ferries" });
    expect(result.offers[0].price).toBeUndefined();
    expect(result.offers[0].segments[0]).toMatchObject({ depart: "2026-11-15T07:40:00+08:00", arrive: "2026-11-15T07:50:00+07:00", durationMin: 70 });
    expect(result.offers[0].attribution).toContain("pre-immigration");
    const row = rowsFor(result.offers, "ferry", null)[0];
    expect(row.estimated).toBe(true);
    expect(row.source).toContain("pre-immigration");
  });

  it("uses independently sourced reverse Batam times and restricted departure days", async () => {
    const offers = await search(q("BATAM-CENTRE", "SG-HARBOURFRONT"));
    expect(offers[0].segments[0]).toMatchObject({ depart: "2026-11-15T06:00:00+07:00", arrive: "2026-11-15T08:10:00+08:00" });
    const mon = await search(q("BATAM-CENTRE", "SG-TANAH-MERAH", "2026-11-16"));
    const thu = await search(q("BATAM-CENTRE", "SG-TANAH-MERAH", "2026-11-19"));
    expect(mon.some((o) => o.segments[0].depart.includes("T07:45:"))).toBe(false);
    expect(thu.some((o) => o.segments[0].depart.includes("T07:45:"))).toBe(true);
  });

  it("keeps exact terminal pairing and doesn't substitute a nearby Singapore terminal", async () => {
    const offers = await search(q("SG-TANAH-MERAH", "BATAM-CENTRE"));
    expect(offers).toHaveLength(1);
    expect(offers[0].segments[0].from.name).toContain("Tanah Merah");
    expect(offers[0].segments[0].depart).toContain("T12:30:");
    expect(provider.covers({ ...q("SG-TANAH-MERAH", "BATAM-CENTRE"), modes: ["bus"] })).toBe(false);
    expect(provider.covers(q("SG-TANAH-MERAH", "SG-TANAH-MERAH"))).toBe(false);
    expect(await search(q("SG-TANAH-MERAH", "BATAM-CENTRE", "2026-09-16"))).toEqual([]);
  });

  it("uses separately sourced Bintan directions and origin-local weekday restrictions", async () => {
    const monday = await search(q("BINTAN-BBT", "SG-TANAH-MERAH", "2026-11-16"));
    const friday = await search(q("BINTAN-BBT", "SG-TANAH-MERAH", "2026-11-20"));
    const saturday = await search(q("BINTAN-BBT", "SG-TANAH-MERAH", "2026-11-21"));
    expect(monday[0].segments[0]).toMatchObject({ depart: "2026-11-16T08:35:00+07:00", arrive: "2026-11-16T10:45:00+08:00" });
    expect(friday.some((o) => o.segments[0].depart.includes("T16:35:"))).toBe(true);
    expect(saturday.some((o) => o.segments[0].depart.includes("T16:35:"))).toBe(false);
    expect((await search(q("SG-TANAH-MERAH", "BINTAN-BBT", "2026-11-21"))).some((o) => o.segments[0].depart.includes("T09:10:"))).toBe(true);
  });

  it("distinguishes Busan sailing from immigration and next-day disembarkation", async () => {
    const [offer] = await search(q("BUSAN-INTERNATIONAL", "HAKATA-INTERNATIONAL"));
    expect(offer.segments[0]).toMatchObject({ depart: "2026-11-15T22:30:00+09:00", arrive: "2026-11-16T07:30:00+09:00", durationMin: 540 });
    expect(offer.attribution).toContain("disembarkation start");
    const [back] = await search(q("HAKATA-INTERNATIONAL", "BUSAN-INTERNATIONAL"));
    expect(back.segments[0]).toMatchObject({ depart: "2026-11-15T12:30:00+09:00", arrive: "2026-11-15T18:30:00+09:00", durationMin: 360 });
  });

  it("surfaces source-backed ferries through the app's coordinate search", async () => {
    const result = await searchFromCoordinates(q("BUSAN-INTERNATIONAL", "HAKATA-INTERNATIONAL"), new AbortController().signal);
    expect(result.offers.some((o) => o.provider === "official-ferries")).toBe(true);
    expect(result.offers.every((o) => o.kind !== "live")).toBe(true);
    const offer = result.offers.find((o) => o.provider === "official-ferries")!;
    expect(result.offerPairs[offer.id].length).toBeGreaterThan(0);
  });

  it("can save a ferry trip with its full attribution", async () => {
    const date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const query = q("BUSAN-INTERNATIONAL", "HAKATA-INTERNATIONAL", date);
    const offers = await search(query);
    const from = { ...query.from, hub: "ferry:BUSAN-INTERNATIONAL", code: null };
    const to = { ...query.to, hub: "ferry:HAKATA-INTERNATIONAL", code: null };
    const leg = soloLegSchema.parse({ from, to, date, offers, chosen: offers[0].id });
    expect(leg.offers[0].provider).toBe("official-ferries");
    expect(leg.offers[0].attribution).toContain("disembarkation start");
  });

  it("honours cancellation even with offline data", async () => {
    await expect(provider.search(q("SG-TANAH-MERAH", "BINTAN-BBT"), AbortSignal.abort())).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});
