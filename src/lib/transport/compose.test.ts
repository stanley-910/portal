import { describe, expect, it } from "vitest";
import { composeRoutes, minutesFrom } from "./compose";
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
    expect(out.gateways.map((g) => g.name)).toEqual(["Shenzhen North", "Futian"]);
    expect(out.routes[0]).toMatchObject({ type: "via", parts: [{ carrier: "MTR East Rail" }, { number: "G100" }] });
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
