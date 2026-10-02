import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SearchQuery } from "../../types";
import { assertFeedCurrent, buildPairs, parseCsv, readFeed, splitName, tripStarts } from "./build";
import cityList from "./cities.json";
import { createGtfsProvider } from "./index";
import { departuresOn, isoAt } from "./schedule";
import type { City, FeedMeta, PairFile } from "./schema";

const FIXTURE = new URL("./__fixtures__/mini/", import.meta.url);
const files = Object.fromEntries(
  readdirSync(FIXTURE).map((f) => [f, readFileSync(new URL(f, FIXTURE), "utf8")]),
);

const cities: City[] = [
  { id: "bangkok", name: "Bangkok", country: "TH", lat: 13.7563, lng: 100.5018, radiusKm: 20 },
  { id: "chiang-mai", name: "Chiang Mai", country: "TH", lat: 18.7883, lng: 98.9853, radiusKm: 15 },
];

const feedMeta: FeedMeta = {
  id: "mini",
  name: "Mini",
  url: "https://example.test/mini.zip",
  country: "TH",
  licence: "CC BY 4.0",
  attribution: "Data: Mini publisher, CC BY 4.0",
  calendarStart: "20260101",
  calendarEnd: "20261231",
};

const feed = readFeed(files);
const pairs = buildPairs(feed, { feedId: "mini", cities, routeTypes: [3] });
const bkkCnx = pairs["bangkok__chiang-mai"];

const times = (p: PairFile, date: string) => departuresOn(p, date).map((d) => d.depart);

describe("gtfs csv", () => {
  it("parses quoted fields with commas and strips BOM", () => {
    expect(parseCsv('﻿a,b\n"x, y","z"\r\n')).toEqual([{ a: "x, y", b: "z" }]);
  });

  it("splits bilingual 'Thai;English' names keeping English", () => {
    expect(splitName("หมอชิต 2;Mo Chit 2")).toEqual({ en: "Mo Chit 2", local: "หมอชิต 2" });
    expect(splitName("KL Sentral")).toEqual({ en: "KL Sentral", local: undefined });
  });
});

describe("gtfs build", () => {
  it("emits both directions, bus only, no intra-city pairs", () => {
    expect(Object.keys(pairs).sort()).toEqual(["bangkok__chiang-mai", "chiang-mai__bangkok"]);
    expect(bkkCnx.departures.every((d) => d.mode === "bus")).toBe(true);
    expect(bkkCnx.departures.some((d) => d.id.startsWith("mini:T5:"))).toBe(false);
  });

  it("writes the expected pair JSON for one departure", () => {
    const d = bkkCnx.departures.find((x) => x.id === "mini:T1:26700");
    expect(d).toEqual({
      id: "mini:T1:26700",
      feed: "mini",
      op: "The Transport Co., Ltd.",
      num: "18",
      mode: "bus",
      tz: "Asia/Bangkok",
      svc: "mini:WK",
      from: "mini:10",
      to: "mini:30",
      dep: 26700,
      arr: 26700 + 8 * 3600 + 38 * 60,
    });
    expect(bkkCnx.stops["mini:10"]).toEqual({ name: "Mo Chit 2", lat: 13.8131, lng: 100.5479 });
    expect(bkkCnx.services["mini:WK"]).toEqual({
      days: [1, 1, 1, 1, 1, 0, 0],
      start: "20260101",
      end: "20261231",
      add: [],
      remove: ["20261013"],
    });
  });

  it("expands namtang frequency windows: headway 0 = single run, chained windows end-inclusive (ADR-B02, ADR-B04)", () => {
    expect(tripStarts([{ start: 60_600, end: 60_600, headway: 0 }])).toEqual([60_600]);
    expect(
      tripStarts([
        { start: 36_000, end: 77_400, headway: 41_400 },
        { start: 77_400, end: 79_200, headway: 1_800 },
      ]),
    ).toEqual([36_000, 77_400, 79_200]);
    const t1 = bkkCnx.departures.filter((d) => d.id.startsWith("mini:T1:")).map((d) => d.dep);
    expect(t1).toEqual([26_700, 72_000]);
    const t2 = bkkCnx.departures.filter((d) => d.id.startsWith("mini:T2:")).map((d) => d.dep);
    expect(t2).toEqual([60_600]);
  });

  it("fails loudly when the feed calendar has ended", () => {
    expect(() => assertFeedCurrent("mini", feed, "20261231")).not.toThrow();
    expect(() => assertFeedCurrent("mini", feed, "20270101")).toThrow(/calendar ended 20261231/);
  });
});

describe("gtfs schedule", () => {
  it("filters by weekday", () => {
    // 2026-10-10 is a Saturday: WK trip T1 must not run, daily T2/T3 do.
    const sat = departuresOn(bkkCnx, "2026-10-10").map((d) => d.departure.id);
    expect(sat.some((id) => id.startsWith("mini:T1:"))).toBe(false);
    expect(sat.some((id) => id.startsWith("mini:T2:"))).toBe(true);
    const tue = departuresOn(bkkCnx, "2026-10-06").map((d) => d.departure.id);
    expect(tue.filter((id) => id.startsWith("mini:T1:"))).toHaveLength(2);
  });

  it("calendar_dates exception removes a date and adds another", () => {
    const on13 = departuresOn(bkkCnx, "2026-10-13").map((d) => d.departure.id);
    expect(on13.some((id) => id.startsWith("mini:T1:"))).toBe(false);
    const back = departuresOn(pairs["chiang-mai__bangkok"], "2026-10-13");
    expect(back.map((d) => d.depart)).toEqual([
      "2026-10-13T10:00:00+07:00",
      "2026-10-13T21:30:00+07:00",
      "2026-10-13T22:00:00+07:00",
    ]);
    expect(departuresOn(pairs["chiang-mai__bangkok"], "2026-10-14")).toEqual([]);
  });

  it("25:10 departure rolls into the next calendar day", () => {
    const t3 = departuresOn(bkkCnx, "2026-10-06").find((d) => d.departure.id.startsWith("mini:T3:"));
    expect(t3?.depart).toBe("2026-10-06T01:10:00+07:00");
    expect(t3?.arrive).toBe("2026-10-06T09:00:00+07:00");
  });

  it("emits ISO times with the agency timezone offset, arrival past midnight", () => {
    expect(isoAt("2026-10-06", 72_000, "Asia/Bangkok")).toBe("2026-10-06T20:00:00+07:00");
    expect(isoAt("2026-10-06", 100_680, "Asia/Bangkok")).toBe("2026-10-07T03:58:00+07:00");
    expect(isoAt("2026-10-06", 3_600, "Asia/Kuala_Lumpur")).toBe("2026-10-06T01:00:00+08:00");
    const late = departuresOn(bkkCnx, "2026-10-06").find((d) => d.departure.id === "mini:T1:72000");
    expect(late?.arrive).toBe("2026-10-07T04:38:00+07:00");
    expect(times(bkkCnx, "2026-10-06").every((t) => t.endsWith("+07:00"))).toBe(true);
  });
});

describe("gtfs provider", () => {
  const provider = createGtfsProvider({
    cities,
    feeds: [feedMeta],
    pairs: { "bangkok__chiang-mai": async () => bkkCnx },
  });
  const q = (over: Partial<SearchQuery> = {}): SearchQuery => ({
    from: { name: "Bangkok", lat: 13.75, lng: 100.5 },
    to: { name: "Chiang Mai", lat: 18.79, lng: 98.98 },
    date: "2026-10-06",
    modes: [],
    passengers: 1,
    currency: "USD",
    ...over,
  });

  it("covers only city pairs with a pair file and bus mode", () => {
    expect(provider.covers(q())).toBe(true);
    expect(provider.covers(q({ modes: ["bus"] }))).toBe(true);
    expect(provider.covers(q({ modes: ["flight"] }))).toBe(false);
    expect(provider.covers(q({ from: q().to, to: q().from }))).toBe(false);
    expect(provider.covers(q({ from: { name: "Nowhere", lat: 0, lng: 0 } }))).toBe(false);
  });

  it("returns timetable offers sorted by departure with attribution", async () => {
    const offers = await provider.search(q(), AbortSignal.timeout(1_000));
    expect(offers.map((o) => o.segments[0].depart)).toEqual([
      "2026-10-06T01:10:00+07:00",
      "2026-10-06T07:25:00+07:00",
      "2026-10-06T16:50:00+07:00",
      "2026-10-06T20:00:00+07:00",
    ]);
    const first = offers[1];
    expect(first).toMatchObject({
      id: "gtfs:mini:T1:26700:2026-10-06",
      provider: "gtfs",
      mode: "bus",
      kind: "timetable",
      attribution: "Data: Mini publisher, CC BY 4.0",
    });
    expect(first.price).toBeUndefined();
    expect(first.segments[0]).toEqual({
      mode: "bus",
      carrier: "The Transport Co., Ltd.",
      number: "18",
      from: { name: "Mo Chit 2", lat: 13.8131, lng: 100.5479, country: "TH", providerIds: { gtfs: "mini:10" } },
      to: { name: "Chiang Mai Arcade", lat: 18.8005, lng: 99.0173, country: "TH", providerIds: { gtfs: "mini:30" } },
      depart: "2026-10-06T07:25:00+07:00",
      arrive: "2026-10-06T16:03:00+07:00",
      durationMin: 518,
    });
  });
});

describe("gtfs rail (T05)", () => {
  const KTMB = new URL("./__fixtures__/ktmb/", import.meta.url);
  const ktmb = readFeed(
    Object.fromEntries(readdirSync(KTMB).map((f) => [f, readFileSync(new URL(f, KTMB), "utf8")])),
  );
  const allCities = cityList as City[];
  const rail = buildPairs(ktmb, { feedId: "ktmb", cities: allCities, routeTypes: [2] });
  const klPen = rail["kuala-lumpur__penang"];
  const ktmbMeta: FeedMeta = { ...feedMeta, id: "ktmb", country: "MY", attribution: "Data: KTMB via data.gov.my" };

  it("KTMB ETS: KL Sentral → Butterworth as a train leg, operator from agency_name", () => {
    expect(klPen.departures.find((d) => d.id === "ktmb:1010:29700")).toEqual({
      id: "ktmb:1010:29700",
      feed: "ktmb",
      op: "Keretapi Tanah Melayu",
      num: "ETS",
      mode: "train",
      tz: "Asia/Kuala_Lumpur",
      svc: "ktmb:ets",
      from: "ktmb:19100",
      to: "ktmb:100",
      dep: 8 * 3600 + 15 * 60,
      arr: 15 * 3600 + 8 * 60,
    });
    expect(klPen.stops["ktmb:19100"].name).toBe("KL SENTRAL");
    expect(klPen.stops["ktmb:100"].name).toBe("BUTTERWORTH");
  });

  it("picks the stop nearest the city centre, not the first one inside the radius", () => {
    // 9326 JB→Butterworth enters KL at Bdr Tasek Selatan; 9323 reaches KL at Sungai Buloh first.
    expect(klPen.departures.find((d) => d.id.startsWith("ktmb:9326:"))?.from).toBe("ktmb:19100");
    expect(rail["penang__kuala-lumpur"].departures.find((d) => d.id.startsWith("ktmb:9323:"))?.to).toBe("ktmb:19100");
    expect(rail["kuala-lumpur__penang"].departures.every((d) => d.to === "ktmb:100")).toBe(true);
  });

  it("drops Komuter (route_type 0) and pins Woodlands CIQ to Singapore for the ST shuttle", () => {
    const ids = Object.values(rail).flatMap((p) => p.departures.map((d) => d.id));
    expect(ids.some((id) => id.startsWith("ktmb:weekday_"))).toBe(false);
    expect(rail["johor-bahru__singapore"].departures.map((d) => d.id)).toEqual(["ktmb:61:18000"]);
    expect(rail["singapore__johor-bahru"].departures[0]).toMatchObject({ from: "ktmb:37600", to: "ktmb:37500", num: "ST" });
  });

  it("fails loudly once the KTMB calendar (ends 20261015) is past", () => {
    expect(() => assertFeedCurrent("ktmb", ktmb, "20261015")).not.toThrow();
    expect(() => assertFeedCurrent("ktmb", ktmb, "20261016")).toThrow(/ktmb calendar ended 20261015/);
  });

  it("KL → Penang returns train offers", async () => {
    const provider = createGtfsProvider({
      cities: allCities,
      feeds: [ktmbMeta],
      pairs: { "kuala-lumpur__penang": async () => klPen },
    });
    const q: SearchQuery = {
      from: { name: "Kuala Lumpur", lat: 3.14, lng: 101.69 },
      to: { name: "Penang", lat: 5.41, lng: 100.33 },
      date: "2026-10-06",
      modes: ["train"],
      passengers: 1,
      currency: "MYR",
    };
    expect(provider.modes).toContain("train");
    expect(provider.covers(q)).toBe(true);
    const offers = await provider.search(q, AbortSignal.timeout(1_000));
    expect(offers.length).toBe(2);
    expect(offers[0]).toMatchObject({ provider: "gtfs", mode: "train", kind: "timetable", attribution: ktmbMeta.attribution });
    expect(offers[0].segments[0]).toMatchObject({
      mode: "train",
      carrier: "Keretapi Tanah Melayu",
      number: "ETS",
      from: { name: "KL SENTRAL", country: "MY" },
      to: { name: "BUTTERWORTH", country: "MY" },
      depart: "2026-10-06T08:15:00+08:00",
      arrive: "2026-10-06T15:08:00+08:00",
    });
  });

  it("drops placeholder-timed legs (namtang SRT copies run 00:00 → 00:07 Bangkok → Chiang Mai)", () => {
    const bogus = readFeed({
      ...files,
      "trips.txt": `${files["trips.txt"]}"R2","ALL","T7","Chiang Mai","0","","2"\n`,
      "stop_times.txt": `${files["stop_times.txt"]}"T7","00:00:00","00:01:00","40","1","0"\n"T7","00:07:00","00:07:00","30","2","0"\n`,
    });
    const p = buildPairs(bogus, { feedId: "mini", cities, routeTypes: [2, 3] })["bangkok__chiang-mai"];
    expect(p.departures.some((d) => d.id.startsWith("mini:T7:"))).toBe(false);
    expect(p.departures.some((d) => d.id.startsWith("mini:T5:"))).toBe(true);
  });

  it("Bangkok → Chiang Mai returns SRT trains and buses when route_type 2 is included", async () => {
    const both = buildPairs(feed, { feedId: "mini", cities, routeTypes: [2, 3] })["bangkok__chiang-mai"];
    const srt = both.departures.filter((d) => d.mode === "train");
    expect(srt).toEqual([
      expect.objectContaining({ id: "mini:T5:64800", op: "State Railway of Thailand", num: "9", from: "mini:40", to: "mini:30" }),
    ]);
    const provider = createGtfsProvider({ cities, feeds: [feedMeta], pairs: { "bangkok__chiang-mai": async () => both } });
    const q: SearchQuery = {
      from: { name: "Bangkok", lat: 13.75, lng: 100.5 },
      to: { name: "Chiang Mai", lat: 18.79, lng: 98.98 },
      date: "2026-10-06",
      modes: [],
      passengers: 1,
      currency: "THB",
    };
    const modes = (await provider.search(q, AbortSignal.timeout(1_000))).map((o) => o.mode);
    expect(new Set(modes)).toEqual(new Set(["bus", "train"]));
    const trainsOnly = await provider.search({ ...q, modes: ["train"] }, AbortSignal.timeout(1_000));
    expect(trainsOnly.map((o) => o.segments[0].carrier)).toEqual(["State Railway of Thailand"]);
  });
});
