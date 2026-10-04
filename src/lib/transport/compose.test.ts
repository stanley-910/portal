import { describe, expect, it } from "vitest";
import { closest, composeRoutes, minutesFrom } from "./compose";
import { approx } from "./fx";
import chinaRail from "./providers/china-rail";
import crossBorder from "./providers/cross-border";
import type { Offer, SearchQuery } from "./types";

const HONG_KONG = { name: "Hong Kong", lat: 22.3193, lng: 114.1694 };
const SHANGHAI = { name: "Shanghai", lat: 31.2304, lng: 121.4737 };
const GUANGZHOU = { name: "Guangzhou", lat: 23.1291, lng: 113.2644 };

// The real offline seeds, without the network providers.
async function search(q: SearchQuery): Promise<Offer[]> {
  const out = await Promise.all([chinaRail, crossBorder].map((p) =>
    p.covers(q) ? p.search(q, AbortSignal.timeout(1000)).catch(() => []) : []));
  return out.flat();
}

const input = { from: HONG_KONG, to: SHANGHAI, date: "2026-10-20", currency: "CNY" };

describe("composeRoutes", () => {
  it("finds Shenzhen North as a cheaper gateway from Hong Kong to Shanghai", async () => {
    const out = await composeRoutes(input, search);
    expect(out.baseline).toMatchObject({ type: "direct", total: { amount: 973, currency: "CNY", converted: false } });
    expect(out.gateways.map((g) => g.name)).toContain("Shenzhen North");
    const [best] = out.routes;
    expect(best).toMatchObject({ id: "R1", type: "via", via: { name: "Shenzhen North" }, estimated: true });
    expect(best.parts.map((p) => p.carrier ?? p.number)).toEqual(["MTR East Rail", "G100"]);
    // the 07:21 and 07:43 trains leave before the first MTR could get there; HK$58 ≈ ¥54 + ¥878.5, against ¥973
    expect(best.total).toMatchObject({ amount: 932, currency: "CNY", converted: true });
    expect(best.saves).toBe(41);
  });

  it("treats a city put at its airport as the whole city, but a border as elsewhere", async () => {
    // "Hong Kong" on the home globe is Hong Kong airport, 25 km from West Kowloon and 37 km from Shenzhen North
    const airport = { name: "Hong Kong", lat: 22.31184, lng: 113.914862 };
    const out = await composeRoutes({ ...input, from: airport }, search);
    expect(out.baseline?.parts[0].from.name).toBe("Hong Kong West Kowloon");
    // nothing in Hong Kong itself; Shenzhen's stations and the nearby mainland airports
    expect(out.gateways.map((g) => g.name)).toEqual(expect.arrayContaining(["Shenzhen North", "Futian", "Shenzhen Bao'an International Airport"]));
    expect(out.gateways.map((g) => g.name)).not.toContain("Hong Kong West Kowloon");
    expect(out.routes[0]).toMatchObject({ type: "via", parts: [{ carrier: "MTR East Rail" }, { number: "G100" }] });
  });

  it("estimates getting to a nearby airport nothing models, and flies from it", async () => {
    // Shenzhen airport is cheap; Hong Kong's isn't
    const SZX = { name: "Shenzhen Bao'an International Airport", lat: 22.639299, lng: 113.810997, country: "CN", iata: "SZX" };
    const flight = (from: typeof SZX | typeof HONG_KONG, price: number, depart: string): Offer => ({
      id: `f:${from.name}:${depart}`, provider: "duffel", mode: "flight", kind: "live", price: { amount: price, currency: "CNY" },
      segments: [{ mode: "flight", from, to: SHANGHAI, depart, arrive: depart.replace(/T(\d\d)/, (_, h) => `T${String(+h + 2).padStart(2, "0")}`), durationMin: 120 }],
    });
    const fake = async (q: SearchQuery) => [
      ...await search(q),
      ...(q.from.name === SZX.name ? [flight(SZX, 500, `${q.date}T10:00:00+08:00`)] : []),
      ...(q.from === input.from ? [flight(HONG_KONG, 1200, `${q.date}T10:00:00+08:00`)] : []),
    ];
    const out = await composeRoutes({ ...input, from: HONG_KONG }, fake);
    const best = out.routes[0];
    expect(best).toMatchObject({ via: { name: SZX.name }, estimated: true });
    expect(best.parts[0]).toMatchObject({ provider: "ground", kind: "estimated", carrier: "Ground transfer and border", arrive: "2026-10-20T08:30:00+08:00" });
    expect(best.parts[0].note).toMatch(/straight-line/);
    expect(best.saves).toBeGreaterThan(300);
  });

  it("connects overnight: the last train in, the first one out the next morning", async () => {
    const station = (name: string, lat: number, lng: number) => ({ name, lat, lng, country: "CN" });
    const A = station("Origin", 22.3, 114.17), B = station("Gateway", 23.2, 114.9), C = station("Far", 31.2, 121.4);
    const train = (from: typeof A, to: typeof A, depart: string, arrive: string, price: number): Offer => ({
      id: `t:${from.name}:${depart}`, provider: "china-rail", mode: "train", kind: "timetable", price: { amount: price, currency: "CNY" },
      segments: [{ mode: "train", from, to, depart, arrive, durationMin: 60 }],
    });
    const fake = async (q: SearchQuery): Promise<Offer[]> =>
      q.from === A && q.to === C ? [train(A, C, "2026-10-20T09:00:00+08:00", "2026-10-20T17:00:00+08:00", 900)]
      : q.from === A && q.to.name === "Gateway" ? [train(A, B, "2026-10-20T21:00:00+08:00", "2026-10-20T22:30:00+08:00", 50)]
      : q.from.name === "Gateway" && q.date === "2026-10-21" ? [train(B, C, "2026-10-21T07:00:00+08:00", "2026-10-21T14:00:00+08:00", 400)]
      : q.from.name === "Gateway" ? [train(B, C, "2026-10-20T10:00:00+08:00", "2026-10-20T17:00:00+08:00", 600)]
      : [];
    // the gateway is found through the direct search
    const direct = async (q: SearchQuery) => q.from === A && q.to === C
      ? [...await fake(q), train(B, C, "2026-10-20T10:00:00+08:00", "2026-10-20T17:00:00+08:00", 600)] : fake(q);
    const out = await composeRoutes({ from: A, to: C, date: "2026-10-20", currency: "CNY" }, direct);
    const overnight = out.routes.find((r) => r.parts[1]?.depart.startsWith("2026-10-21"));
    expect(overnight).toMatchObject({ total: { amount: 450 }, saves: 450, arrive: "2026-10-21T14:00:00+08:00" });
  });

  it("doesn't take an early train only to wait half a day for the next", async () => {
    const out = await composeRoutes({ ...input, arriveNear: "22:40" }, search);
    for (const r of out.routes) {
      const [first, second] = r.parts;
      if (second) expect(Date.parse(second.depart) - Date.parse(first.arrive)).toBeLessThanOrEqual(180 * 60_000);
    }
  });

  it("doesn't treat a provider's spelled-out country as another country", async () => {
    const named = async (q: SearchQuery) => (await search(q)).map((o) => ({
      ...o, segments: o.segments.map((s) => ({ ...s, from: { ...s.from, country: s.from.country === "HK" ? "Hong Kong" : s.from.country } })),
    }));
    const out = await composeRoutes(input, named);
    expect(out.baseline?.parts[0].from.name).toBe("Hong Kong West Kowloon");
  });

  it("never lists the baseline's service again as an alternative", async () => {
    const twice = async (q: SearchQuery) => { const o = await search(q); return [...o, ...o.map((x) => ({ ...x, id: `${x.id}:again` }))] };
    const out = await composeRoutes(input, twice);
    const key = (p: { carrier: string | null; number: string | null; depart: string }) => `${p.number}:${p.depart}`;
    expect(out.routes.map((r) => key(r.parts.at(-1)!))).not.toContain(key(out.baseline!.parts[0]));
  });

  it("chains the connector so it reaches the station before the train, inside service hours", async () => {
    const { routes } = await composeRoutes(input, search);
    for (const r of routes) {
      const [first, second] = r.parts;
      const gap = (Date.parse(second.depart) - Date.parse(first.arrive)) / 60_000;
      expect(gap).toBeGreaterThanOrEqual(20);
      if (first.flexible) expect(gap).toBe(25);
    }
  });

  it("puts the route that arrives with a friend first, even when it costs more", async () => {
    // a friend's train gets into Hongqiao at 22:40
    const out = await composeRoutes({ ...input, arriveNear: "2026-10-20T22:40:00+08:00", windowMin: 30 }, search);
    expect(out.routes[0].arrive).toBe("2026-10-20T22:42:00+08:00");
    expect(out.routes[0].gapMin).toBe(2);
  });

  it("reads an arrival target without an offset as local time where they arrive", async () => {
    const out = await composeRoutes({ ...input, arriveNear: "2026-10-20T22:40", windowMin: 30 }, search);
    expect(out.routes[0]).toMatchObject({ arrive: "2026-10-20T22:42:00+08:00", gapMin: 2 });
    const bare = await composeRoutes({ ...input, arriveNear: "22:40", windowMin: 30 }, search);
    expect(bare.routes[0]).toMatchObject({ gapMin: 2 });
    expect(minutesFrom("2026-10-20T14:40:00Z", "2026-10-20T22:42:00+08:00")).toBe(2);
  });

  it("never uses a provider's test inventory", async () => {
    const fake = async (q: SearchQuery) => [...await search(q), {
      id: "duffel:test", provider: "duffel", mode: "flight", kind: "live", sandbox: true,
      price: { amount: 10, currency: "CNY" },
      segments: [{ mode: "flight", from: HONG_KONG, to: SHANGHAI, depart: "2026-10-20T12:00:00+08:00", arrive: "2026-10-20T14:00:00+08:00", durationMin: 120 }],
    } satisfies Offer];
    const out = await composeRoutes(input, fake);
    expect([out.baseline, ...out.routes].flatMap((r) => r?.parts ?? []).map((p) => p.offerId)).not.toContain("duffel:test");
  });

  it("keeps a route with an unpriced part but gives it no total or saving", async () => {
    const out = await composeRoutes({ from: SHANGHAI, to: HONG_KONG, date: "2026-10-20", currency: "CNY" }, search);
    const unpriced = out.routes.concat(out.baseline ?? []).filter((r) => r.parts.some((p) => !p.price));
    for (const r of unpriced) expect(r).toMatchObject({ total: null, saves: null });
  });

  it("puts routes within a stated budget ahead of cheaper-looking unknowns", async () => {
    const out = await composeRoutes({ ...input, maxFare: 950 }, search);
    expect(out.routes[0].total!.amount).toBeLessThanOrEqual(950);
  });

  it("doesn't route through a gateway that's further from the destination", async () => {
    const out = await composeRoutes({ from: GUANGZHOU, to: SHANGHAI, date: "2026-10-20", currency: "CNY" }, search);
    expect(out.gateways.map((g) => g.name)).not.toContain("Hong Kong West Kowloon");
  });

  it("converts between known currencies and refuses unknown ones", () => {
    expect(approx(100, "HKD", "CNY")).toBeCloseTo(92.75, 1);
    expect(approx(100, "XXX", "CNY")).toBeNull();
  });
});

describe("closest", () => {
  const KAOHSIUNG = { name: "Kaohsiung", lat: 22.6273, lng: 120.3014 };
  const end = (id: string, mode: Offer["mode"], to: { name: string; lat: number; lng: number }): Offer => ({
    id, provider: "rail-cache", mode, kind: "timetable",
    segments: [{ mode, from: { name: "Taipei", lat: 25.0478, lng: 121.517 }, to, depart: "2026-10-17T08:00:00+08:00", arrive: "2026-10-17T10:00:00+08:00", durationMin: 120 }],
  });

  it("drops a train that stops short of where another one gets to", () => {
    const zuoying = end("zuoying", "train", { name: "Zuoying", lat: 22.6873, lng: 120.3076 });
    const tainan = end("tainan", "train", { name: "Tainan", lat: 22.925, lng: 120.2856 });
    const airport = end("khh", "flight", { name: "Kaohsiung Airport", lat: 22.5771, lng: 120.35 });
    expect(closest([tainan, zuoying, airport], KAOHSIUNG).map((o) => o.id)).toEqual(["zuoying", "khh"]);
  });

  it("drops a train that starts further out than others leave from", () => {
    const TAIPEI = { name: "Taipei", lat: 25.0478, lng: 121.517 };
    const zuoying = { name: "Zuoying", lat: 22.6873, lng: 120.3076 };
    const fromTaipei = end("taipei", "train", zuoying);
    const fromTaoyuan: Offer = { ...end("taoyuan", "train", zuoying), segments: [{ ...fromTaipei.segments[0], from: { name: "Taoyuan", lat: 25.0129, lng: 121.2149 } }] };
    expect(closest([fromTaoyuan, fromTaipei], KAOHSIUNG, TAIPEI).map((o) => o.id)).toEqual(["taipei"]);
  });

  it("keeps the nearest a mode gets when nothing gets closer", () => {
    const tainan = end("tainan", "train", { name: "Tainan", lat: 22.925, lng: 120.2856 });
    expect(closest([tainan], KAOHSIUNG).map((o) => o.id)).toEqual(["tainan"]);
  });
});
