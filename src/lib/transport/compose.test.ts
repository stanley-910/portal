import { describe, expect, it } from "vitest";
import { composeRoutes } from "./compose";
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
