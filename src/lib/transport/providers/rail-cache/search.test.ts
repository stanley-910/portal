import { describe, expect, it } from "vitest";
import { createScheduleSearch, runsOn } from "./search";
import { createRailCacheProvider } from "./index";
import type { ScheduleCache } from "./schema";
import cacheJson from "./cache.json";

const cache = cacheJson as ScheduleCache;
const search = createScheduleSearch(cache);
function station(name: string, country: string) {
  return new Set(Object.entries(cache.stations).filter(([, s]) => s.country === country &&
    [s.name, ...s.aliases].includes(name)).map(([id]) => id));
}
const hk = station("Hong Kong West Kowloon", "HK");
const shanghai = station("Shanghai Hongqiao", "CN");

describe("downloaded rail schedules", () => {
  it("preserves the visually checked sleeper weekday and overnight arrival", () => {
    const found = search(hk, shanghai, "2026-10-04").filter((j) => j.trip.number === "G900");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ depart: "2026-10-04T20:00:00+08:00", arrive: "2026-10-05T06:58:00+08:00", durationMin: 658 });
    expect(search(hk, shanghai, "2026-10-06").some((j) => j.trip.number === "G900")).toBe(false);
    expect(search(hk, shanghai, "2026-10-06").some((j) => j.trip.number === "G896")).toBe(true);
  });
  it("does not sell the sleeper's prohibited short HK–Shenzhen segment", () => {
    expect(search(hk, station("Shenzhenbei", "CN"), "2026-10-04").some((j) => j.trip.number === "G900")).toBe(false);
  });
  it("keeps 12306 observations on their actual travel date", () => {
    const from = station("VNP", "CN"), to = station("AOH", "CN");
    const find = (date: string) => search(from, to, date).filter((j) => cache.sources[j.trip.source].group === "china-12306-sample");
    expect(find("2026-10-04").some((j) => j.trip.number === "G1" && j.durationMin === 294)).toBe(true);
    expect(find("2026-10-05")).toHaveLength(0);
  });
  it("uses the train's origin date when boarding after midnight", () => {
    const found = search(station("Yiwu", "CN"), hk, "2026-10-07").filter((j) => j.trip.number === "G895");
    // Yiwu departure is before midnight; Ganzhouxi is next day.
    expect(found.every((j) => j.depart.startsWith("2026-10-07"))).toBe(true);
    const overnight = search(station("Ganzhouxi", "CN"), hk, "2026-10-09").filter((j) => j.trip.number === "G895");
    expect(overnight).toHaveLength(1); // Thursday origin, Friday boarding
    expect(overnight[0].depart).toBe("2026-10-09T05:21:00+08:00");
    expect(search(station("Ganzhouxi", "CN"), hk, "2026-10-10").some((j) => j.trip.number === "G895")).toBe(false);
  });
  it("lets holiday calendars replace THSR base schedules", () => {
    const base = cache.trips.find((t) => cache.sources[t.source].group === "thsr" && t.calendar.start === "2026-02-02")!;
    expect(runsOn(base.calendar, "2026-10-10")).toBe(false);
    const found = search(station("Taipei", "TW"), station("Zuoying", "TW"), "2026-10-10");
    expect(found.length).toBeGreaterThan(20);
    expect(found.every((j) => j.trip.calendar.kind === "dated")).toBe(true);
  });
  it("keeps Japan reseller prices absent and limits dates", () => {
    const from = station("Tokyo", "JP"), to = station("Niigata", "JP");
    const onDate = search(from, to, "2026-10-04");
    expect(onDate).toHaveLength(25);
    expect(onDate.every((j) => j.trip.number === "")).toBe(true);
    expect(search(from, to, "2026-11-04")).toHaveLength(0);
  });
  it("serves the demo rail leg from disk with provenance and no invented fare", async () => {
    const provider = createRailCacheProvider(cache);
    const query = { from: { name: "HK", country: "HK", lat: 22.3036, lng: 114.165 },
      to: { name: "Shanghai", country: "CN", lat: 31.196, lng: 121.3161 }, date: "2026-10-04",
      modes: ["train" as const], passengers: 2, currency: "USD" };
    expect(provider.covers(query)).toBe(true);
    const offers = await provider.search(query, new AbortController().signal);
    expect(offers.some((o) => o.segments[0].number === "G900")).toBe(true);
    expect(offers.every((o) => o.kind === "timetable" && !o.price && o.attribution?.includes("Fares and seats not checked"))).toBe(true);
  });
  it("has valid station references and strictly ordered source times", () => {
    for (const trip of cache.trips) {
      expect(cache.sources[trip.source], trip.id).toBeDefined();
      let previous = -1;
      for (const stop of trip.stops) {
        expect(cache.stations[stop.station], trip.id).toBeDefined();
        for (const time of [stop.arrival, stop.departure]) {
          if (time === undefined) continue;
          expect(time, trip.id).toBeGreaterThanOrEqual(previous);
          previous = time;
        }
      }
    }
  });
});

describe("source-specific extraction safeguards", () => {
  it("does not turn Korean skipped-stop zeroes into midnight services", () => {
    const trip = cache.trips.find((t) => cache.sources[t.source].group === "korail" && t.number === "1" &&
      t.stops.some((s) => cache.stations[s.station].aliases.includes("서울")));
    expect(trip).toBeDefined();
    expect(trip!.stops.every((s) => s.arrival !== 0 && s.departure !== 0)).toBe(true);
    expect(trip!.stops[0].departure).toBe(5 * 3600 + 13 * 60);
  });
  it("withholds Thai cancellations and conflicting restart dates", () => {
    const thai = cache.trips.filter((t) => cache.sources[t.source].group === "thailand");
    expect(thai.some((t) => ["405", "406", "173", "174"].includes(t.number))).toBe(false);
  });
  it("rejects invalid dates rather than rolling them into another month", () => {
    expect(search(hk, shanghai, "2026-02-31")).toHaveLength(0);
  });
});
