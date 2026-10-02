import { afterEach, describe, expect, it, vi } from "vitest";
import type { Place, SearchQuery } from "../../types";
import provider, { createKoreaTagoProvider } from "./index";
import { parseTrainSeed, trainSeed } from "./seed";
import { KORAIL_BOOKING_URL } from "./train";
import trainSeedJson from "./train-seed.json";
import trainStationsJson from "./train-stations.json";

const city = (name: string, lat: number, lng: number): Place => ({ name, lat, lng });
const SEOUL = city("Seoul", 37.5547, 126.9707);
const BUSAN = city("Busan", 35.1151, 129.0422);
const GWANGJU = city("Gwangju", 35.1595, 126.8526);
const MOKPO = city("Mokpo", 34.8118, 126.3922);
const DAEGU = city("Daegu", 35.8714, 128.6014);
const INCHEON = city("Incheon", 37.4563, 126.7052);
const TAIPEI = city("Taipei", 25.0478, 121.517);
const KUALA_LUMPUR = city("Kuala Lumpur", 3.1478, 101.6953);

// 2026-10-06 = Tuesday.
const q = (from: Place, to: Place, extra: Partial<SearchQuery> = {}): SearchQuery => ({
  from, to, date: "2026-10-06", modes: [], passengers: 1, currency: "USD", ...extra,
});
const signal = () => AbortSignal.timeout(1_000);

const PAIRS = [
  ["seoul", "busan"], ["seoul", "daejeon"], ["seoul", "dongdaegu"], ["seoul", "gwangju-songjeong"],
  ["yongsan", "gwangju-songjeong"], ["seoul", "gangneung"], ["yongsan", "mokpo"],
];

afterEach(() => vi.unstubAllGlobals());

describe("korea-tago train seed", () => {
  it("parses; rejects unknown stations and bad rows", () => {
    expect(trainSeed.trains.length).toBeGreaterThan(0);
    const row = trainSeedJson.trains[0];
    expect(() => parseTrainSeed(trainStationsJson, { ...trainSeedJson, trains: [{ ...row, to: "pyongyang" }] })).toThrow();
    expect(() => parseTrainSeed(trainStationsJson, { ...trainSeedJson, trains: [{ ...row, departures: ["5:13"] }] })).toThrow();
    expect(() => parseTrainSeed(trainStationsJson, { ...trainSeedJson, trains: [{ ...row, source: "" }] })).toThrow();
  });

  it("every station and every train row cites an https source", () => {
    for (const s of Object.values(trainSeed.stations)) expect(s.source).toMatch(/^https:\/\//);
    for (const t of trainSeed.trains) {
      expect(t.source, `${t.from}>${t.to} ${t.number}`).toMatch(/^https:\/\//);
      expect(t.fareKrw).toBeGreaterThan(0);
    }
  });

  it("seeds every demo pair in both directions", () => {
    for (const [a, b] of PAIRS) {
      expect(trainSeed.trains.some((t) => t.from === a && t.to === b), `${a}>${b}`).toBe(true);
      expect(trainSeed.trains.some((t) => t.from === b && t.to === a), `${b}>${a}`).toBe(true);
    }
  });
});

describe("korea-tago provider", () => {
  it("declares train only (bus lands in B02)", () => {
    expect(provider.id).toBe("korea-tago");
    expect(provider.modes).toEqual(["train"]);
  });

  it("Seoul → Busan returns sorted KTX timetable offers at +09:00 with KRW fares", async () => {
    const offers = await provider.search(q(SEOUL, BUSAN), signal());
    expect(offers.length).toBeGreaterThan(30);
    const ktx1 = offers.find((o) => o.segments[0].number === "1");
    expect(ktx1).toMatchObject({
      provider: "korea-tago",
      mode: "train",
      kind: "timetable",
      price: { amount: 54400, currency: "KRW" },
      bookingUrl: KORAIL_BOOKING_URL,
      segments: [
        {
          mode: "train",
          carrier: "KTX",
          from: { name: "Seoul", country: "KR", providerIds: { "korea-tago": "seoul" } },
          to: { name: "Busan", country: "KR" },
          depart: "2026-10-06T05:13:00+09:00",
          arrive: "2026-10-06T07:50:00+09:00",
          durationMin: 157,
        },
      ],
    });
    for (const o of offers) {
      expect(o.segments[0].depart).toMatch(/^2026-10-06T\d{2}:\d{2}:00\+09:00$/);
      expect(o.price?.currency).toBe("KRW");
    }
    const departs = offers.map((o) => Date.parse(o.segments[0].depart));
    expect(departs).toEqual([...departs].sort((a, b) => a - b));
  });

  it("Busan → Seoul returns the reverse direction", async () => {
    const offers = await provider.search(q(BUSAN, SEOUL), signal());
    expect(offers.length).toBeGreaterThan(30);
    expect(offers.every((o) => o.segments[0].from.name === "Busan" && o.segments[0].to.name === "Seoul")).toBe(true);
  });

  it("a Seoul query matches Yongsan too (Honam trains), Mokpo → Seoul lands at Yongsan", async () => {
    const toGwangju = await provider.search(q(SEOUL, GWANGJU), signal());
    expect(new Set(toGwangju.map((o) => o.segments[0].from.name))).toEqual(new Set(["Seoul", "Yongsan"]));
    const fromMokpo = await provider.search(q(MOKPO, SEOUL), signal());
    expect(fromMokpo.length).toBeGreaterThan(0);
    expect(fromMokpo.every((o) => o.segments[0].to.name === "Yongsan")).toBe(true);
  });

  it("rows with days run only on those weekdays", async () => {
    const mini = createKoreaTagoProvider({
      train: { ...trainSeed, trains: [{ ...trainSeed.trains[0], departures: ["07:00"], days: [0, 6] }] },
    });
    expect(await mini.search(q(SEOUL, BUSAN), signal())).toEqual([]);
    expect(await mini.search(q(SEOUL, BUSAN, { date: "2026-10-10" }), signal())).toHaveLength(1);
  });

  it("rolls arrival past midnight", async () => {
    const mini = createKoreaTagoProvider({
      train: { ...trainSeed, trains: [{ ...trainSeed.trains[0], departures: ["22:28"], durationMin: 160 }] },
    });
    const [o] = await mini.search(q(SEOUL, BUSAN), signal());
    expect(o.segments[0].arrive).toBe("2026-10-07T01:08:00+09:00");
  });

  it("unseeded pairs → covers false, search UNSUPPORTED_ROUTE", async () => {
    expect(provider.covers(q(BUSAN, DAEGU))).toBe(false); // both seeded stations, pair not seeded
    expect(provider.covers(q(INCHEON, BUSAN))).toBe(false); // > 15 km from any station
    await expect(provider.search(q(BUSAN, DAEGU), signal())).rejects.toMatchObject({ code: "UNSUPPORTED_ROUTE" });
  });

  it("never claims Taiwan or Malaysia queries", () => {
    expect(provider.covers(q(TAIPEI, city("Kaohsiung", 22.6394, 120.3025)))).toBe(false);
    expect(provider.covers(q(KUALA_LUMPUR, city("Penang", 5.4141, 100.3288)))).toBe(false);
  });

  it("covers respects modes", () => {
    expect(provider.covers(q(SEOUL, BUSAN))).toBe(true);
    expect(provider.covers(q(SEOUL, BUSAN, { modes: ["train"] }))).toBe(true);
    expect(provider.covers(q(SEOUL, BUSAN, { modes: ["bus"] }))).toBe(false);
    expect(provider.covers(q(SEOUL, BUSAN, { modes: ["flight"] }))).toBe(false);
  });

  it("makes no network calls: search succeeds with fetch throwing, empty env", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network disabled");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const offers = await provider.search(q(SEOUL, BUSAN), signal());
    expect(offers.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
