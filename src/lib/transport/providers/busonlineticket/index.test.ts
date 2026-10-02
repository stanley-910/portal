import { describe, expect, it } from "vitest";
import type { Place, SearchQuery } from "../../types";
import provider, { createBusOnlineTicketProvider } from "./index";
import { botRouteUrl } from "./links";
import { seedSchema } from "./schema";
import seedJson from "./seed.json";

const seed = seedSchema.parse(seedJson);

const city = (name: string, lat: number, lng: number): Place => ({ name, lat, lng });
const KL = city("Kuala Lumpur", 3.139, 101.6869);
const SINGAPORE = city("Singapore", 1.3521, 103.8198);
const PENANG = city("George Town", 5.4141, 100.3288);
const HAT_YAI = city("Hat Yai", 7.0086, 100.4747);
const JB = city("Johor Bahru", 1.4927, 103.7414);
const BANGKOK = city("Bangkok", 13.7563, 100.5018);

const DATE = "2026-10-20";
const q = (from: Place, to: Place, extra: Partial<SearchQuery> = {}): SearchQuery => ({
  from, to, date: DATE, modes: [], passengers: 1, currency: "USD", ...extra,
});
const signal = () => AbortSignal.timeout(1_000);

describe("busonlineticket seed", () => {
  it("parses against the schema and rejects unknown cities / tz mismatch", () => {
    expect(seedSchema.safeParse(seedJson).success).toBe(true);
    const bad = { ...seed.routes[0], from: "nowhere" };
    expect(seedSchema.safeParse({ ...seedJson, routes: [bad] }).success).toBe(false);
    const kl = seed.routes.find((r) => r.from === "kuala-lumpur");
    const badTz = { ...kl, tz: "Asia/Bangkok" };
    expect(seedSchema.safeParse({ ...seedJson, routes: [badTz] }).success).toBe(false);
  });

  it("has ≥ 10 city pairs, each row citing its BOT route page", () => {
    const pairs = new Set(seed.routes.map((r) => `${r.from}>${r.to}`));
    expect(pairs.size).toBeGreaterThanOrEqual(10);
    for (const p of ["kuala-lumpur>singapore", "kuala-lumpur>penang", "kuala-lumpur>malacca", "kuala-lumpur>ipoh", "singapore>malacca", "kuala-lumpur>johor-bahru", "penang>hat-yai"]) {
      expect(pairs.has(p), p).toBe(true);
    }
    for (const r of seed.routes) {
      expect(r.source, `${r.from}>${r.to}`).toBe(botRouteUrl(seed.cities[r.from].botSlug, seed.cities[r.to].botSlug));
    }
  });
});

describe("botRouteUrl", () => {
  it("lowercases and dashes BOT city names, no query without referer", () => {
    expect(botRouteUrl("Kuala Lumpur", "Singapore")).toBe(
      "https://www.busonlineticket.com/booking/kuala-lumpur-to-singapore-bus-tickets",
    );
  });

  it("adds an encoded refererid only when given", () => {
    expect(botRouteUrl("penang", "hatyai", "ab c&1")).toBe(
      "https://www.busonlineticket.com/booking/penang-to-hatyai-bus-tickets?refererid=ab+c%261",
    );
    expect(botRouteUrl("penang", "hatyai", "")).not.toContain("?");
  });
});

describe("busonlineticket provider", () => {
  it("declares bus only", () => {
    expect(provider.id).toBe("busonlineticket");
    expect(provider.modes).toEqual(["bus"]);
  });

  it("KL → Singapore returns sorted bus timetable offers linking to the BOT route page", async () => {
    expect(provider.covers(q(KL, SINGAPORE))).toBe(true);
    const offers = await provider.search(q(KL, SINGAPORE), signal());
    expect(offers.length).toBeGreaterThanOrEqual(5);
    const kkkl = offers.find((o) => o.segments[0].carrier === "KKKL Express (Terus Nanti)");
    expect(kkkl).toMatchObject({
      id: `busonlineticket:kuala-lumpur:singapore:kkkl-express-terus-nanti:${DATE}T08:00`,
      provider: "busonlineticket",
      mode: "bus",
      kind: "timetable",
      bookingUrl: "https://www.busonlineticket.com/booking/kuala-lumpur-to-singapore-bus-tickets",
      segments: [
        {
          mode: "bus",
          from: { name: "Kuala Lumpur", country: "MY", providerIds: { busonlineticket: "kuala-lumpur" } },
          to: { name: "Singapore", country: "SG", providerIds: { busonlineticket: "singapore" } },
          depart: `${DATE}T08:00:00+08:00`,
          arrive: `${DATE}T14:30:00+08:00`,
          durationMin: 390,
        },
      ],
    });
    expect(kkkl?.price).toBeUndefined();
    const departs = offers.map((o) => Date.parse(o.segments[0].depart));
    expect(departs).toEqual([...departs].sort((a, b) => a - b));
    expect(new Set(offers.map((o) => o.id)).size).toBe(offers.length);
  });

  it("tags links with refererid when configured", async () => {
    const tagged = createBusOnlineTicketProvider(seed, { refererId: "portal42" });
    const [offer] = await tagged.search(q(KL, SINGAPORE), signal());
    expect(offer.bookingUrl).toBe(
      "https://www.busonlineticket.com/booking/kuala-lumpur-to-singapore-bus-tickets?refererid=portal42",
    );
  });

  it("Hat Yai → Penang departs at +07:00 and arrives at +08:00", async () => {
    const offers = await provider.search(q(HAT_YAI, PENANG), signal());
    expect(offers.length).toBeGreaterThan(0);
    const o = offers[0].segments[0];
    expect(o.depart.endsWith("+07:00")).toBe(true);
    expect(o.arrive.endsWith("+08:00")).toBe(true);
    expect((Date.parse(o.arrive) - Date.parse(o.depart)) / 60_000).toBe(o.durationMin);
    expect(offers[0].bookingUrl).toBe("https://www.busonlineticket.com/booking/hatyai-to-penang-bus-tickets");
  });

  it("rolls arrival past midnight", async () => {
    const mini = createBusOnlineTicketProvider({
      ...seed,
      routes: [{ ...seed.routes.find((r) => r.from === "kuala-lumpur" && r.to === "singapore")!, departures: ["23:45"] }],
    });
    const [o] = await mini.search(q(KL, SINGAPORE), signal());
    expect(o.segments[0].depart).toBe(`${DATE}T23:45:00+08:00`);
    expect(o.segments[0].arrive).toBe("2026-10-21T06:15:00+08:00");
  });

  it("JB and Singapore resolve to different cities", async () => {
    const offers = await provider.search(q(JB, KL), signal());
    expect(offers.every((o) => o.segments[0].from.name === "Johor Bahru")).toBe(true);
  });

  it("unseeded pair → covers false, search UNSUPPORTED_ROUTE", async () => {
    expect(provider.covers(q(BANGKOK, KL))).toBe(false);
    expect(provider.covers(q(KL, KL))).toBe(false);
    await expect(provider.search(q(BANGKOK, KL), signal())).rejects.toMatchObject({ code: "UNSUPPORTED_ROUTE" });
  });

  it("covers respects modes", () => {
    expect(provider.covers(q(KL, SINGAPORE, { modes: ["bus"] }))).toBe(true);
    expect(provider.covers(q(KL, SINGAPORE, { modes: ["train", "flight"] }))).toBe(false);
  });
});
