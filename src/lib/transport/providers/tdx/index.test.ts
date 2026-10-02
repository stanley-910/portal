import { afterEach, describe, expect, it, vi } from "vitest";
import type { Place, SearchQuery } from "../../types";
import provider, { createTdxProvider } from "./index";
import { THSR_BOOKING_URL } from "./links";
import { busSeedSchema, busTerminalsSchema, seedSchema, type SeedTrain } from "./schema";
import busSeedJson from "./bus-seed.json";
import busTerminalsJson from "./bus-terminals.json";
import seedJson from "./seed.json";

const seed = seedSchema.parse(seedJson);
const busSeed = busSeedSchema.parse(busSeedJson);
const busTerminals = busTerminalsSchema.parse(busTerminalsJson);

const city = (name: string, lat: number, lng: number): Place => ({ name, lat, lng });
const TAIPEI = city("Taipei", 25.0478, 121.517);
const ZUOYING = city("Zuoying", 22.6873, 120.3076);
const TAICHUNG = city("Taichung", 24.1125, 120.616);
const TAINAN = city("Tainan", 22.925, 120.2862);
const HUALIEN = city("Hualien", 23.9929, 121.6011);
const CHIAYI = city("Chiayi HSR", 23.4593, 120.3232);

const WED = "2026-10-14";
const SUN = "2026-10-18";
// THSR tests pin modes to train: since B01 an empty `modes` also returns buses.
const q = (from: Place, to: Place, extra: Partial<SearchQuery> = {}): SearchQuery => ({
  from, to, date: WED, modes: ["train"], passengers: 1, currency: "USD", ...extra,
});
const signal = () => AbortSignal.timeout(1_000);
const LINE = ["nangang", "taipei", "banqiao", "taoyuan", "hsinchu", "miaoli", "taichung", "changhua", "yunlin", "chiayi", "tainan", "zuoying"];
const train = (number: string, direction: "S" | "N"): SeedTrain | undefined =>
  seed.trains.find((t) => t.number === number && t.direction === direction);
const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

describe("tdx (THSR) seed", () => {
  it("parses against the schema", () => {
    expect(seedSchema.safeParse(seedJson).success).toBe(true);
    expect(seedSchema.safeParse({ ...seedJson, trains: [{ number: "1", direction: "S", stops: [], source: "x" }] }).success).toBe(false);
  });

  it("has the 12 THSR stations with TDX ids and citations", () => {
    expect(Object.keys(seed.stations)).toEqual(LINE);
    expect(seed.stations.taipei.id).toBe("1000");
    expect(seed.stations.zuoying.id).toBe("1070");
    for (const s of Object.values(seed.stations)) expect(s.source).toMatch(/^https:\/\//);
  });

  it("every train cites a source, stops in line order, times increase (rolling past midnight)", () => {
    expect(seed.trains.length).toBeGreaterThan(100);
    for (const t of seed.trains) {
      expect(t.source, t.number).toMatch(/^https:\/\/www\.thsrc\.com\.tw\//);
      const order = t.direction === "S" ? LINE : [...LINE].reverse();
      const idx = t.stops.map(([s]) => order.indexOf(s));
      expect(idx.every((i) => i >= 0), t.number).toBe(true);
      expect(idx, t.number).toEqual([...idx].sort((a, b) => a - b));
      let prev = -1;
      let total = 0;
      for (const [, hhmm] of t.stops) {
        const m = mins(hhmm);
        const step = prev < 0 ? 0 : (m - prev + 1440) % 1440;
        total += step;
        prev = m;
      }
      expect(total, t.number).toBeLessThan(6 * 60);
    }
  });

  it("covers Taipei → Zuoying every hour 06:00–22:00 in both directions on a weekday", () => {
    for (const [dir, from] of [["S", "taipei"], ["N", "zuoying"]] as const) {
      const hours = new Set(
        seed.trains
          .filter((t) => t.direction === dir && !t.days)
          .flatMap((t) => t.stops.filter(([s]) => s === from).map(([, hhmm]) => Number(hhmm.slice(0, 2)))),
      );
      for (let h = 6; h <= 21; h++) expect(hours.has(h), `${dir} ${h}:00`).toBe(true);
    }
  });
});

describe("tdx (THSR) provider", () => {
  it("declares train and bus", () => {
    expect(provider.id).toBe("tdx");
    expect(provider.modes).toEqual(["train", "bus"]);
  });

  it("Taipei → Zuoying returns southbound THSR timetable offers at +08:00, sorted", async () => {
    const offers = await provider.search(q(TAIPEI, ZUOYING), signal());
    expect(offers.length).toBeGreaterThan(40);
    expect(offers.every((o) => train(o.segments[0].number ?? "", "S"))).toBe(true);
    const departs = offers.map((o) => Date.parse(o.segments[0].depart));
    expect(departs).toEqual([...departs].sort((a, b) => a - b));
    const t0803 = offers.find((o) => o.segments[0].number === "0803");
    expect(t0803).toMatchObject({
      id: `tdx:0803:taipei:${WED}`,
      provider: "tdx",
      mode: "train",
      kind: "timetable",
      bookingUrl: THSR_BOOKING_URL,
      segments: [
        {
          mode: "train",
          carrier: "THSR",
          number: "0803",
          from: { name: "Taipei", country: "TW", providerIds: { tdx: "1000" } },
          to: { name: "Zuoying", country: "TW", providerIds: { tdx: "1070" } },
          depart: `${WED}T06:26:00+08:00`,
          arrive: `${WED}T08:40:00+08:00`,
          durationMin: 134,
        },
      ],
    });
    expect(t0803?.price).toBeUndefined();
  });

  it("Zuoying → Taipei returns northbound trains only", async () => {
    const offers = await provider.search(q(ZUOYING, TAIPEI), signal());
    expect(offers.length).toBeGreaterThan(40);
    expect(offers.every((o) => train(o.segments[0].number ?? "", "N"))).toBe(true);
    expect(offers.every((o) => o.segments[0].from.name === "Zuoying" && o.segments[0].to.name === "Taipei")).toBe(true);
  });

  it("intermediate pair Taichung → Tainan uses each train's own stop times", async () => {
    const offers = await provider.search(q(TAICHUNG, TAINAN), signal());
    const t0803 = offers.find((o) => o.segments[0].number === "0803");
    expect(t0803?.segments[0]).toMatchObject({
      depart: `${WED}T07:32:00+08:00`,
      arrive: `${WED}T08:28:00+08:00`,
      durationMin: 56,
    });
    for (const o of offers) {
      const t = train(o.segments[0].number ?? "", "S");
      const at = (s: string) => t?.stops.find(([k]) => k === s)?.[1];
      expect(o.segments[0].depart).toBe(`${WED}T${at("taichung")}:00+08:00`);
    }
  });

  it("trains with days run only on those weekdays", async () => {
    const t1202 = train("1202", "N");
    expect(t1202?.days).toEqual([1, 2, 3, 4, 5]);
    const has1202 = async (date: string) =>
      (await provider.search(q(ZUOYING, TAIPEI, { date }), signal())).some((o) => o.segments[0].number === "1202");
    expect(await has1202(WED)).toBe(true);
    expect(await has1202(SUN)).toBe(false);
  });

  it("rolls arrival past midnight; origin after midnight checks the previous day's weekday", async () => {
    const mini = createTdxProvider({
      ...seed,
      trains: [
        { number: "1336", direction: "N", days: [0], stops: [["taichung", "22:55"], ["taipei", "23:56"], ["nangang", "00:05"]], source: "https://www.thsrc.com.tw/" },
        { number: "1698", direction: "N", days: [0], stops: [["taichung", "23:30"], ["banqiao", "00:10"], ["taipei", "00:19"]], source: "https://www.thsrc.com.tw/" },
      ],
    });
    const late = await mini.search(q(TAICHUNG, TAIPEI, { date: SUN }), signal());
    expect(late.map((o) => o.segments[0].arrive)).toEqual(["2026-10-18T23:56:00+08:00", "2026-10-19T00:19:00+08:00"]);
    const banqiao = city("Banqiao", 25.0142, 121.4638);
    // Leaves Banqiao 00:10 on Monday, but the train started Sunday (days [0]).
    const mon = await mini.search(q(banqiao, TAIPEI, { date: "2026-10-19" }), signal());
    expect(mon.map((o) => o.segments[0].depart)).toEqual(["2026-10-19T00:10:00+08:00"]);
    expect(await mini.search(q(banqiao, TAIPEI, { date: SUN }), signal())).toEqual([]);
  });

  it("Taipei → Hualien (TRA only) → covers false, search UNSUPPORTED_ROUTE", async () => {
    expect(provider.covers(q(TAIPEI, HUALIEN))).toBe(false);
    await expect(provider.search(q(TAIPEI, HUALIEN), signal())).rejects.toMatchObject({ code: "UNSUPPORTED_ROUTE" });
  });

  it("same nearest station both ends → covers false", () => {
    expect(provider.covers(q(TAIPEI, city("Taipei Main", 25.046, 121.5175)))).toBe(false);
  });

  it("covers respects modes", () => {
    expect(provider.covers(q(TAIPEI, ZUOYING))).toBe(true);
    expect(provider.covers(q(TAIPEI, ZUOYING, { modes: ["train"] }))).toBe(true);
    // Chiayi has THSR but no seeded bus; Zuoying is within 10 km of Kaohsiung's bus terminal.
    expect(provider.covers(q(TAIPEI, CHIAYI, { modes: ["bus"] }))).toBe(false);
    expect(provider.covers(q(TAIPEI, CHIAYI, { modes: [] }))).toBe(true);
  });
});

const KAOHSIUNG = city("Kaohsiung", 22.6394, 120.3021);
const YILAN = city("Yilan", 24.7547, 121.7582);
// THSR Tainan sits in Guiren, ~11 km from the bus terminal; the bus test uses the city centre.
const TAINAN_CITY = city("Tainan", 22.9908, 120.2133);
const qb = (from: Place, to: Place, extra: Partial<SearchQuery> = {}): SearchQuery => ({
  from, to, date: WED, modes: ["bus"], passengers: 1, currency: "USD", ...extra,
});
const OPERATORS = new Set(["Ubus", "Kuo-Kuang", "Ho-Hsin", "Kamalan", "Capital"]);

describe("tdx (intercity bus) seed", () => {
  it("parses against the schemas", () => {
    expect(busSeedSchema.safeParse(busSeedJson).success).toBe(true);
    expect(busTerminalsSchema.safeParse(busTerminalsJson).success).toBe(true);
    expect(busSeedSchema.safeParse({ ...busSeedJson, trips: [{ route: "nope", sub: "x", stops: [["taipei", "06:00"], ["yilan", "07:00"]] }] }).success).toBe(false);
  });

  it("every route, terminal cites an https source; every trip stop is a known terminal", () => {
    for (const [id, r] of Object.entries(busSeed.routes)) {
      expect(r.source, id).toMatch(/^https:\/\/tdx\.transportdata\.tw\/api\/basic\/v2\/Bus\/Schedule\/InterCity\//);
      expect(r.crossCheck, id).toMatch(/^https:\/\/www\.taiwanbus\.tw\//);
      expect(OPERATORS.has(r.operator), id).toBe(true);
    }
    for (const t of Object.values(busTerminals.terminals)) expect(t.source).toMatch(/^https:\/\//);
    for (const t of busSeed.trips) for (const [k] of t.stops) expect(k in busTerminals.terminals, `${t.sub} ${k}`).toBe(true);
  });

  it("seeds Taipei ↔ Taichung, Kaohsiung, Tainan, Yilan in both directions", () => {
    const cityOf = (k: string) => busTerminals.terminals[k].city;
    const pairs = new Set(busSeed.trips.flatMap((t) => t.stops.flatMap(([a], i) => t.stops.slice(i + 1).map(([b]) => `${cityOf(a)}>${cityOf(b)}`))));
    for (const c of ["Taichung", "Kaohsiung", "Tainan", "Yilan"]) {
      expect(pairs.has(`Taipei>${c}`), c).toBe(true);
      expect(pairs.has(`${c}>Taipei`), c).toBe(true);
    }
  });
});

describe("tdx (intercity bus) provider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("Taipei → Taichung returns 國道客運 timetable offers at +08:00, sorted, any date", async () => {
    const offers = await provider.search(qb(TAIPEI, TAICHUNG), signal());
    expect(offers.length).toBeGreaterThan(30);
    expect(offers.every((o) => o.mode === "bus" && o.kind === "timetable" && o.provider === "tdx")).toBe(true);
    const departs = offers.map((o) => Date.parse(o.segments[0].depart));
    expect(departs).toEqual([...departs].sort((a, b) => a - b));
    const kk = offers.find((o) => o.segments[0].number === "1827" && o.segments[0].depart === `${WED}T06:00:00+08:00`);
    expect(kk).toMatchObject({
      provider: "tdx",
      mode: "bus",
      kind: "timetable",
      segments: [
        {
          mode: "bus",
          carrier: "Kuo-Kuang",
          number: "1827",
          from: { name: "Taipei Bus Station", country: "TW", providerIds: { tdx: "taipei" } },
          to: { name: "Taichung Chaoma", country: "TW", providerIds: { tdx: "chaoma" } },
          arrive: `${WED}T07:51:00+08:00`,
          durationMin: 111,
        },
      ],
    });
    expect(kk?.bookingUrl).toMatch(/^https:\/\//);
    expect(new Set(offers.map((o) => o.id)).size).toBe(offers.length);
    expect((await provider.search(qb(TAIPEI, TAICHUNG, { date: "2027-03-03" }), signal())).length).toBe(offers.length);
  });

  it("Taichung → Taipei returns the reverse direction", async () => {
    const offers = await provider.search(qb(TAICHUNG, TAIPEI), signal());
    expect(offers.length).toBeGreaterThan(30);
    expect(offers.every((o) => o.segments[0].to.providerIds?.tdx === "taipei")).toBe(true);
    expect(offers.some((o) => o.segments[0].number === "1827" && o.segments[0].depart === `${WED}T06:32:00+08:00`)).toBe(true);
  });

  it("Taipei ↔ Kaohsiung, Tainan, Yilan all return offers both ways", async () => {
    for (const c of [KAOHSIUNG, TAINAN_CITY, YILAN]) {
      expect((await provider.search(qb(TAIPEI, c), signal())).length, `to ${c.name}`).toBeGreaterThan(0);
      expect((await provider.search(qb(c, TAIPEI), signal())).length, `from ${c.name}`).toBeGreaterThan(0);
    }
  });

  it("Yilan buses board at the Taipei-area terminal nearest the origin", async () => {
    const offers = await provider.search(qb(TAIPEI, YILAN), signal());
    const kk = offers.filter((o) => o.segments[0].number === "1878");
    expect(kk.length).toBeGreaterThan(10);
    // Most 1878 runs call at Yuanshan, then Nangang; Yuanshan is nearer central Taipei.
    const from = new Set(kk.map((o) => o.segments[0].from.providerIds?.tdx));
    expect([...from].sort()).toEqual(["nangang", "yuanshan"]);
    const yuanshan = kk.filter((o) => o.segments[0].from.providerIds?.tdx === "yuanshan").length;
    expect(yuanshan).toBeGreaterThan(kk.length / 2);
  });

  it("trips with days run only on those weekdays", async () => {
    const at = async (date: string) =>
      (await provider.search(qb(YILAN, TAIPEI, { date }), signal())).filter((o) => o.segments[0].number === "1878" && o.segments[0].depart.endsWith("T05:40:00+08:00"));
    // 05:40 runs as 1878 Mon–Thu, 1878A Fri–Sun (different stop times); one per day either way.
    expect((await at(WED)).map((o) => o.segments[0].arrive)).toEqual([`${WED}T06:54:00+08:00`]);
    expect((await at(SUN)).map((o) => o.segments[0].arrive)).toEqual([`${SUN}T06:50:00+08:00`]);
  });

  it("arrival rolls past midnight", async () => {
    const late = (await provider.search(qb(TAIPEI, TAICHUNG), signal())).find(
      (o) => o.segments[0].number === "1619" && o.segments[0].depart === `${WED}T23:00:00+08:00`,
    );
    expect(late?.segments[0]).toMatchObject({ arrive: "2026-10-15T00:58:00+08:00", durationMin: 118 });
  });

  it("modes: train excludes bus; bus excludes THSR; empty returns both", async () => {
    const train = await provider.search(q(TAIPEI, TAICHUNG, { modes: ["train"] }), signal());
    expect(train.length).toBeGreaterThan(0);
    expect(train.every((o) => o.mode === "train")).toBe(true);
    const bus = await provider.search(qb(TAIPEI, TAICHUNG), signal());
    expect(bus.every((o) => o.mode === "bus")).toBe(true);
    const all = await provider.search(q(TAIPEI, TAICHUNG, { modes: [] }), signal());
    expect(all.length).toBe(train.length + bus.length);
  });

  it("unseeded pair → covers false, search UNSUPPORTED_ROUTE", async () => {
    expect(provider.covers(qb(TAIPEI, HUALIEN))).toBe(false);
    expect(provider.covers(qb(TAIPEI, CHIAYI))).toBe(false);
    await expect(provider.search(qb(TAIPEI, CHIAYI), signal())).rejects.toMatchObject({ code: "UNSUPPORTED_ROUTE" });
    expect(provider.covers(qb(TAIPEI, TAICHUNG))).toBe(true);
  });

  it("makes no request-time fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await provider.search(qb(TAIPEI, KAOHSIUNG), signal());
    await provider.search(q(TAIPEI, ZUOYING, { modes: [] }), signal());
    provider.covers(qb(YILAN, TAIPEI));
    expect(spy).not.toHaveBeenCalled();
  });
});
