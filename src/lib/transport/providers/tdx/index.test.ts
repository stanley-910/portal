import { describe, expect, it } from "vitest";
import type { Place, SearchQuery } from "../../types";
import provider, { createTdxProvider } from "./index";
import { THSR_BOOKING_URL } from "./links";
import { seedSchema, type SeedTrain } from "./schema";
import seedJson from "./seed.json";

const seed = seedSchema.parse(seedJson);

const city = (name: string, lat: number, lng: number): Place => ({ name, lat, lng });
const TAIPEI = city("Taipei", 25.0478, 121.517);
const ZUOYING = city("Zuoying", 22.6873, 120.3076);
const TAICHUNG = city("Taichung", 24.1125, 120.616);
const TAINAN = city("Tainan", 22.925, 120.2862);
const HUALIEN = city("Hualien", 23.9929, 121.6011);

const WED = "2026-10-14";
const SUN = "2026-10-18";
const q = (from: Place, to: Place, extra: Partial<SearchQuery> = {}): SearchQuery => ({
  from, to, date: WED, modes: [], passengers: 1, currency: "USD", ...extra,
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
  it("declares train only", () => {
    expect(provider.id).toBe("tdx");
    expect(provider.modes).toEqual(["train"]);
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
    expect(provider.covers(q(TAIPEI, ZUOYING, { modes: ["bus"] }))).toBe(false);
  });
});
