import { describe, expect, it } from "vitest";
import { composeRoutes } from "@/lib/transport/compose";
import chinaRail from "@/lib/transport/providers/china-rail";
import crossBorder from "@/lib/transport/providers/cross-border";
import type { Offer, SearchQuery } from "@/lib/transport/types";
import { describeRoutes } from "./optimize";
import { routeOps } from "./tools";

const via = { at: { lat: 22.6119, lng: 114.0239, hub: "train:SHENZHEN-NORTH", code: null, name: "Shenzhen North" } };

const base = (riders: string[]) => ({ leg: "L1", riders, date: "2026-10-20", from: "S1", to: "S2", createdAt: 5 });

describe("routeOps", () => {
  it("replaces the leg when everyone takes the route", () => {
    expect(routeOps(base(["M1"]), via)).toEqual([
      { op: "add_leg", from: { stop: "S1" }, to: via, date: "2026-10-20", riders: ["M1"], createdAt: 5.1 },
      { op: "add_leg", from: via, to: { stop: "S2" }, date: "2026-10-20", riders: ["M1"], createdAt: 5.2 },
      { op: "remove_leg", leg: "L1" },
    ]);
  });

  it("leaves the others on the original leg", () => {
    const ops = routeOps(base(["M1", "M2"]), via, ["M2"]);
    expect(Array.isArray(ops) && ops[2]).toEqual({ op: "set_riders", leg: "L1", riders: ["M1"] });
  });

  it("refuses riders who aren't on the leg", () => {
    expect(routeOps(base(["M1"]), via, ["M3"])).toMatchObject({ refused: "NOT_ON_LEG" });
  });
});

describe("describeRoutes", () => {
  it("states each part, the total, the saving and the arrival gap the model must quote", async () => {
    const search = async (q: SearchQuery): Promise<Offer[]> => (await Promise.all([chinaRail, crossBorder].map((p) =>
      p.covers(q) ? p.search(q, AbortSignal.timeout(1000)).catch(() => []) : []))).flat();
    const composed = await composeRoutes({
      from: { name: "Hong Kong", lat: 22.3193, lng: 114.1694 }, to: { name: "Shanghai", lat: 31.2304, lng: 121.4737 },
      date: "2026-10-20", currency: "CNY", arriveNear: "2026-10-20T19:30:00+08:00",
    }, search);
    const out = describeRoutes(composed);
    expect(out.baseline).toMatch(/^R0 direct on 2026-10-20: .* CNY 973 \(timetable fare\)/);
    expect(out.routes[0]).toMatch(/^R1 via Shenzhen North on 2026-10-20: MTR East Rail: leave Admiralty \(MTR\) by \d\d:\d\d \(runs every few minutes\)/);
    expect(out.routes[0]).toMatch(/total about CNY 932, saves CNY 41, arrives 5 min before the target\.$/);
    expect(out.note).toMatch(/Tried leaving from: .*Shenzhen North/);
  });
});
