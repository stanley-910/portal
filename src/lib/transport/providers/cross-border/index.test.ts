import { describe, expect, it } from "vitest";
import type { SearchQuery } from "../../types";
import provider, { connectorMinutes, CONNECTORS } from "./index";

const HONG_KONG = { name: "Hong Kong", lat: 22.3193, lng: 114.1694 };
const SHENZHEN = { name: "Shenzhen", lat: 22.5431, lng: 114.0579 };
const SHANGHAI = { name: "Shanghai", lat: 31.2304, lng: 121.4737 };
const q = (from = HONG_KONG, to = SHENZHEN, extra: Partial<SearchQuery> = {}): SearchQuery =>
  ({ from, to, date: "2026-10-20", modes: [], passengers: 1, currency: "USD", ...extra });

describe("cross-border connector", () => {
  it("covers Hong Kong ↔ Shenzhen by train, nothing further", () => {
    expect(provider.covers(q())).toBe(true);
    expect(provider.covers(q(SHENZHEN, HONG_KONG))).toBe(true);
    expect(provider.covers(q(HONG_KONG, SHANGHAI))).toBe(false);
    expect(provider.covers(q(HONG_KONG, SHENZHEN, { modes: ["flight"] }))).toBe(false);
  });

  it("offers estimated MTR + checkpoint + metro trips with the crossing between the two parts", async () => {
    const offers = await provider.search(q(), AbortSignal.timeout(1000));
    expect(offers.length).toBeGreaterThan(3);
    const [first] = offers;
    expect(first).toMatchObject({ provider: "cross-border", kind: "estimated", price: { amount: 58, currency: "HKD" } });
    const [a, b] = first.segments;
    expect(a).toMatchObject({ carrier: "MTR East Rail", depart: "2026-10-20T07:00:00+08:00", arrive: "2026-10-20T07:45:00+08:00" });
    expect(b).toMatchObject({ carrier: "Shenzhen Metro", depart: "2026-10-20T08:15:00+08:00", arrive: "2026-10-20T08:45:00+08:00" });
    expect(first.attribution).toMatch(/checkpoint/);
  });

  it("totals its parts and the crossing", () => {
    for (const c of CONNECTORS) expect(connectorMinutes(c)).toBe(105);
  });
});
