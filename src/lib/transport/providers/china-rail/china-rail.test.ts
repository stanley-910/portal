import { describe, expect, it } from "vitest";
import type { Offer, Place, SearchQuery } from "../../types";
import provider, { createChinaRailProvider } from "./index";
import { tripComTrainUrl } from "./links";
import type { Seed } from "./schema";
import seedJson from "./seed.json";

const seed = seedJson as Seed;

const city = (name: string, lat: number, lng: number): Place => ({ name, lat, lng });
const SHANGHAI = city("Shanghai", 31.2304, 121.4737);
const BEIJING = city("Beijing", 39.9042, 116.4074);
const SHENZHEN = city("Shenzhen", 22.5431, 114.0579);
const HONG_KONG = city("Hong Kong", 22.3193, 114.1694);
const CHENGDU = city("Chengdu", 30.5728, 104.0668);

const q = (from: Place, to: Place, extra: Partial<SearchQuery> = {}): SearchQuery => ({
  from, to, date: "2026-10-20", modes: [], passengers: 1, currency: "USD", ...extra,
});
const signal = () => AbortSignal.timeout(1_000);

describe("china-rail seed", () => {
  it("every train references known stations, cites a source, has HH:MM departures", () => {
    for (const t of seed.trains) {
      expect(seed.stations[t.from], t.number).toBeDefined();
      expect(seed.stations[t.to], t.number).toBeDefined();
      expect(t.source).toMatch(/^https:\/\//);
      expect(t.number).toMatch(/^[GD]\d+$/);
      for (const d of t.departures) expect(d).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      expect(t.durationMin).toBeGreaterThan(0);
    }
  });
});

describe("china-rail provider", () => {
  it("Hong Kong West Kowloon ↔ Shanghai Hongqiao both ways, from MTR's long-haul timetable", async () => {
    const fromKowloon = (offers: Offer[]) => offers.filter((o) => o.segments[0].from.name === "Hong Kong West Kowloon");
    const toKowloon = (offers: Offer[]) => offers.filter((o) => o.segments[0].to.name === "Hong Kong West Kowloon");
    const out = fromKowloon(await provider.search(q(HONG_KONG, SHANGHAI), signal()));
    expect(out.map((o) => o.segments[0].number)).toEqual(["G902", "G386"]);
    expect(out[0].segments[0]).toMatchObject({ depart: "2026-10-20T11:35:00+08:00", durationMin: 488 });
    expect(out[0].price).toEqual({ amount: 973, currency: "CNY", asOf: seed.checked });
    const back = toKowloon(await provider.search(q(SHANGHAI, HONG_KONG), signal()));
    expect(back.map((o) => o.segments[0].number)).toEqual(["G384", "G901"]);
  });

  it("Hong Kong → Shanghai also offers the cheaper trains from Shenzhen, a border crossing away", async () => {
    const out = await provider.search(q(HONG_KONG, SHANGHAI), signal());
    const shenzhen = out.filter((o) => o.segments[0].from.name === "Shenzhen North");
    expect(shenzhen.map((o) => o.segments[0].number)).toEqual(["G700", "G270", "G902", "G100", "G386"]);
    expect(shenzhen[0].price).toMatchObject({ amount: 878.5, currency: "CNY" });
    expect(shenzhen[0].attribution).toMatch(/Second-class fare as published/);
  });

  it("leaves a train without a sourced fare unpriced", async () => {
    const out = await provider.search(q(SHANGHAI, SHENZHEN), signal());
    const g99 = out.find((o) => o.segments[0].number === "G99");
    expect(g99?.price).toBeUndefined();
    expect(g99?.attribution).toMatch(/fare and seats not checked/);
  });

  it("Shanghai → Beijing returns seeded G trains as timetable offers at +08:00", async () => {
    const offers = await provider.search(q(SHANGHAI, BEIJING), signal());
    expect(offers.length).toBeGreaterThan(0);
    const g10 = offers.find((o) => o.segments[0].number === "G10");
    expect(g10).toMatchObject({
      provider: "china-rail",
      mode: "train",
      kind: "timetable",
      segments: [
        {
          from: { name: "Shanghai Hongqiao", country: "CN", providerIds: { "china-rail": "AOH" } },
          to: { name: "Beijing South", providerIds: { "china-rail": "VNP" } },
          depart: "2026-10-20T09:00:00+08:00",
          arrive: "2026-10-20T13:26:00+08:00",
          durationMin: 266,
        },
      ],
    });

    expect(g10?.price).toBeUndefined();
    expect(g10?.attribution).toContain("fare and seats not checked");
    expect(offers.every((o) => o.segments[0].number?.startsWith("G"))).toBe(true);
    const departs = offers.map((o) => Date.parse(o.segments[0].depart));
    expect(departs).toEqual([...departs].sort((a, b) => a - b));
  });

  it("matches globe airport points to the Beijing–Shanghai rail corridor", () => {
    expect(provider.covers(q(
      city("Beijing", 40.08, 116.58),
      city("Shanghai", 31.14, 121.81),
      { modes: ["train"] },
    ))).toBe(true);
  });

  it("Shenzhen → Hong Kong matches both Shenzhen North and Futian, links out to Trip.com", async () => {
    const offers = await provider.search(q(SHENZHEN, HONG_KONG), signal());
    const origins = new Set(offers.map((o) => o.segments[0].from.name));
    expect(origins).toEqual(new Set(["Shenzhen North", "Futian"]));
    expect(offers.every((o) => o.segments[0].to.country === "HK")).toBe(true);
    const url = new URL(offers[0].bookingUrl ?? "");
    expect(url.origin + url.pathname).toBe("https://www.trip.com/trains/china/list");
    expect(url.searchParams.get("arrivalStation")).toBe("香港西九龙");
    expect(url.searchParams.get("departDate")).toBe("2026-10-20");
  });

  it("rolls arrival past midnight onto the next day", async () => {
    const offers = await provider.search(q(city("Hangzhou", 30.2741, 120.1551), SHANGHAI), signal());
    const late = offers.find((o) => o.segments[0].number === "G4918");
    expect(late?.segments[0].depart).toBe("2026-10-20T23:22:00+08:00");
    expect(late?.segments[0].arrive).toBe("2026-10-21T00:07:00+08:00");
  });

  it("unseeded pair → covers false, search UNSUPPORTED_ROUTE", async () => {
    expect(provider.covers(q(CHENGDU, BEIJING))).toBe(false);
    await expect(provider.search(q(CHENGDU, BEIJING), signal())).rejects.toMatchObject({ code: "UNSUPPORTED_ROUTE" });
  });

  it("covers respects modes", () => {
    expect(provider.covers(q(SHANGHAI, BEIJING))).toBe(true);
    expect(provider.covers(q(SHANGHAI, BEIJING, { modes: ["train"] }))).toBe(true);
    expect(provider.covers(q(SHANGHAI, BEIJING, { modes: ["flight"] }))).toBe(false);
  });

  it("emits one offer per departure with stable ids", async () => {
    const mini = createChinaRailProvider({
      ...seed,
      trains: [{ ...seed.trains[0], departures: ["07:00", "08:00"] }],
    });
    const offers = await mini.search(q(BEIJING, SHANGHAI), signal());
    expect(offers.map((o) => o.id)).toEqual([
      `china-rail:${seed.trains[0].number}:beijing-south:2026-10-20T07:00`,
      `china-rail:${seed.trains[0].number}:beijing-south:2026-10-20T08:00`,
    ]);
  });
});

describe("tripComTrainUrl", () => {
  it("encodes Chinese station names", () => {
    expect(tripComTrainUrl(seed.stations["beijing-south"], seed.stations["shanghai-hongqiao"], "2026-10-20")).toBe(
      "https://www.trip.com/trains/china/list?departureStation=%E5%8C%97%E4%BA%AC%E5%8D%97&arrivalStation=%E4%B8%8A%E6%B5%B7%E8%99%B9%E6%A1%A5&departDate=2026-10-20",
    );
  });
});
