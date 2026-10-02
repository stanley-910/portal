import { afterEach, describe, expect, it, vi } from "vitest";
import type { Place, SearchQuery } from "../../types";
import provider, { createSrtProvider } from "./index";
import { SRT_BOOKING_URL } from "./links";
import { seedSchema, type SeedTrain } from "./schema";
import seedJson from "./seed.json";

const seed = seedSchema.parse(seedJson);

const city = (name: string, lat: number, lng: number): Place => ({ name, lat, lng });
const BANGKOK = city("Bangkok", 13.804, 100.5402);
const CHIANG_MAI = city("Chiang Mai", 18.7883, 98.9853);
const AYUTTHAYA = city("Ayutthaya", 14.3532, 100.5689);
const PHITSANULOK = city("Phitsanulok", 16.8211, 100.2659);
const HAT_YAI = city("Hat Yai", 7.0086, 100.4747);
const TAIPEI = city("Taipei", 25.0478, 121.517);
const ZUOYING = city("Zuoying", 22.6873, 120.3076);

const WED = "2026-10-14";
const SAT = "2026-10-17";
const q = (from: Place, to: Place, extra: Partial<SearchQuery> = {}): SearchQuery => ({
  from, to, date: WED, modes: [], passengers: 1, currency: "USD", ...extra,
});
const signal = () => AbortSignal.timeout(1_000);
const train = (number: string): SeedTrain | undefined => seed.trains.find((t) => t.number === number);
const at = (t: SeedTrain | undefined, station: string) => t?.stops.find(([k]) => k === station)?.[1];
const byNumber = async (query: SearchQuery, number: string) =>
  (await provider.search(query, signal())).find((o) => o.segments[0].number === number);

afterEach(() => vi.unstubAllGlobals());

describe("srt seed", () => {
  it("parses against the schema; bad rows fail", () => {
    expect(seedSchema.safeParse(seedJson).success).toBe(true);
    const bad = { number: "9", type: "special", line: "northern", direction: "out", stops: [["nowhere", "18:40"], ["chiang-mai", "07:15"]], source: "https://x" };
    expect(seedSchema.safeParse({ ...seedJson, trains: [bad] }).success).toBe(false);
  });

  it("every station and train cites a source; trains cite the SRT TTS timetable", () => {
    for (const s of Object.values(seed.stations)) expect(s.source).toMatch(/^https:\/\//);
    expect(seed.trains.length).toBeGreaterThan(50);
    for (const t of seed.trains) expect(t.source, t.number).toMatch(/^https:\/\/ttsview\.railway\.co\.th\/SRT_Schedule2022\.php\?ln=en&line=[124]&trip=[12]$/);
  });

  it("Bangkok has both terminals as one city", () => {
    expect(seed.stations["krung-thep-aphiwat"].city).toBe("bangkok");
    expect(seed.stations["hua-lamphong"].city).toBe("bangkok");
  });

  it("each train runs under 24 h with at most one midnight roll", () => {
    for (const t of seed.trains) {
      const m = t.stops.map(([, hhmm]) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)));
      const rolls = m.filter((v, i) => i > 0 && v < m[i - 1]).length;
      expect(rolls, t.number).toBeLessThanOrEqual(1);
    }
  });

  it("seeds the demo sleepers 9/10/13/14 and the southern line", () => {
    for (const n of ["9", "10", "13", "14"]) expect(train(n)?.type, n).toBe("special");
    expect(at(train("9"), "krung-thep-aphiwat")).toBe("18:40");
    expect(at(train("9"), "chiang-mai")).toBe("07:15");
    expect(seed.trains.some((t) => t.line === "southern" && t.stops.some(([k]) => k === "hat-yai"))).toBe(true);
  });
});

describe("srt provider", () => {
  it("declares train only", () => {
    expect(provider.id).toBe("srt");
    expect(provider.modes).toEqual(["train"]);
  });

  it("Bangkok → Chiang Mai: overnight train 9 arrives the next day at +07:00", async () => {
    const offers = await provider.search(q(BANGKOK, CHIANG_MAI), signal());
    expect(offers.length).toBeGreaterThanOrEqual(4);
    const departs = offers.map((o) => Date.parse(o.segments[0].depart));
    expect(departs).toEqual([...departs].sort((a, b) => a - b));
    const t9 = offers.find((o) => o.segments[0].number === "9");
    expect(t9).toMatchObject({
      id: `srt:9:krung-thep-aphiwat:${WED}`,
      provider: "srt",
      mode: "train",
      kind: "timetable",
      bookingUrl: SRT_BOOKING_URL,
      segments: [
        {
          mode: "train",
          carrier: "SRT Special Express",
          number: "9",
          from: { name: "Bangkok (Krung Thep Aphiwat)", country: "TH", providerIds: { srt: "krung-thep-aphiwat" } },
          to: { name: "Chiang Mai", country: "TH", providerIds: { srt: "chiang-mai" } },
          depart: `${WED}T18:40:00+07:00`,
          arrive: "2026-10-15T07:15:00+07:00",
          durationMin: 755,
        },
      ],
    });
    expect(t9?.price).toBeUndefined();
  });

  it("Chiang Mai → Bangkok returns inbound trains only", async () => {
    const offers = await provider.search(q(CHIANG_MAI, BANGKOK), signal());
    expect(offers.length).toBeGreaterThanOrEqual(4);
    for (const o of offers) {
      expect(train(o.segments[0].number ?? "")?.direction).toBe("in");
      expect(o.segments[0].from.name).toBe("Chiang Mai");
      expect(o.segments[0].to.name).toMatch(/^Bangkok \(/);
    }
  });

  it("intermediate pair Ayutthaya → Phitsanulok uses each train's own stop times", async () => {
    const offers = await provider.search(q(AYUTTHAYA, PHITSANULOK), signal());
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) {
      const t = train(o.segments[0].number ?? "");
      expect(o.segments[0].depart).toBe(`${WED}T${at(t, "ayutthaya")}:00+07:00`);
    }
    const t9 = offers.find((o) => o.segments[0].number === "9");
    expect(t9?.segments[0]).toMatchObject({ depart: `${WED}T19:45:00+07:00`, arrive: "2026-10-15T00:17:00+07:00", durationMin: 272 });
  });

  it("days filter: a Mon–Fri train runs on Wednesday, not Saturday", async () => {
    const weekday = seed.trains.find((t) => t.days?.join() === "1,2,3,4,5" && t.stops.some(([k]) => k === "ayutthaya") && t.stops.some(([k]) => seed.stations[k].city === "bangkok"));
    expect(weekday).toBeDefined();
    const [from, to] = weekday!.direction === "out" ? [BANGKOK, AYUTTHAYA] : [AYUTTHAYA, BANGKOK];
    expect(await byNumber(q(from, to), weekday!.number)).toBeDefined();
    expect(await byNumber(q(from, to, { date: SAT }), weekday!.number)).toBeUndefined();
  });

  it("origin after midnight checks the train's start weekday", async () => {
    const mini = createSrtProvider({
      ...seed,
      trains: [{ number: "1", type: "special", line: "northern", direction: "out", days: [3], stops: [["krung-thep-aphiwat", "22:00"], ["phitsanulok", "02:00"], ["chiang-mai", "08:00"]], source: "https://ttsview.railway.co.th/" }],
    });
    // Leaves Phitsanulok 02:00 on Thursday; the train started Wednesday (days [3]).
    const thu = await mini.search(q(PHITSANULOK, CHIANG_MAI, { date: "2026-10-15" }), signal());
    expect(thu.map((o) => o.segments[0].depart)).toEqual(["2026-10-15T02:00:00+07:00"]);
    expect(await mini.search(q(PHITSANULOK, CHIANG_MAI, { date: WED }), signal())).toEqual([]);
  });

  it("Bangkok → Hat Yai crosses the southern line", async () => {
    expect((await provider.search(q(BANGKOK, HAT_YAI), signal())).length).toBeGreaterThan(0);
  });

  it("Taipei → Zuoying → covers false, search UNSUPPORTED_ROUTE", async () => {
    expect(provider.covers(q(TAIPEI, ZUOYING))).toBe(false);
    await expect(provider.search(q(TAIPEI, ZUOYING), signal())).rejects.toMatchObject({ code: "UNSUPPORTED_ROUTE" });
  });

  it("same city both ends → covers false", () => {
    expect(provider.covers(q(BANGKOK, city("Hua Lamphong", 13.7392, 100.5169)))).toBe(false);
  });

  it("covers respects modes", () => {
    expect(provider.covers(q(BANGKOK, CHIANG_MAI))).toBe(true);
    expect(provider.covers(q(BANGKOK, CHIANG_MAI, { modes: ["train"] }))).toBe(true);
    expect(provider.covers(q(BANGKOK, CHIANG_MAI, { modes: ["bus"] }))).toBe(false);
  });

  it("makes no network call at request time", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await provider.search(q(BANGKOK, CHIANG_MAI), signal());
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
