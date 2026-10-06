import { describe, expect, it } from "vitest";
import type { StoredOffer } from "@/lib/liveblocks/types";
import { planIssues } from "./issues";

const stop = (name: string, lat: number, lng: number) => ({ name, lat, lng, hub: null, code: null });
const offer = (id: string, number: string, depart: string, arrive: string, to = "PVG"): StoredOffer => ({
  id, provider: "duffel", mode: "flight", kind: "live", price: { amount: 100, currency: "USD" }, carrier: number.slice(0, 2), depart, arrive,
  durationMin: 150, stops: 0, bookingUrl: null, attribution: null, flights: [{ number, from: "HKG", to, depart }],
});
const leg = (from: string, to: string, riders: string[], chosen: StoredOffer | null, date = "2026-10-20") =>
  ({ from, to, date, riders, createdAt: 1, createdBy: riders[0], votes: {}, chosen: chosen?.id ?? null, search: { id: "s", status: "done" as const, offers: chosen ? [chosen] : [] } });
const stops = { hk: stop("Hong Kong", 22.3, 114.17), sh: stop("Shanghai", 31.23, 121.47), sel: stop("Seoul", 37.56, 126.97), pvg: stop("Shanghai Pudong", 31.14, 121.8) };
const members = { a: { name: "Ann", color: 1 }, b: { name: "Bo", color: 2 }, c: { name: "Cy", color: 3 } };

describe("planIssues", () => {
  it("spots two people on the same trip picking different flights, and offers either", () => {
    const issues = planIssues({ members, stops, legs: {
      l1: leg("hk", "sh", ["a"], offer("o1", "HX234", "2026-10-20T18:30:00+08:00", "2026-10-20T21:00:00+08:00")),
      l2: leg("hk", "pvg", ["b"], offer("o2", "MU506", "2026-10-20T19:10:00+08:00", "2026-10-20T21:40:00+08:00")),
    } } as never);
    expect(issues).toHaveLength(1);
    expect(issues[0].text).toBe("Ann and Bo are both going Hong Kong → Shanghai on Tue, Oct 20, but on different services: HX234 6:30 PM and MU506 7:10 PM. Should you all take the same one?");
    expect(issues[0].fixes).toEqual([
      { kind: "merge", label: "All on HX234 6:30 PM", keep: "l1", drop: "l2" },
      { kind: "merge", label: "All on MU506 7:10 PM", keep: "l2", drop: "l1" },
    ]);
  });

  it("keys two people on different flights the same whichever order the legs are read in", () => {
    const l1 = leg("hk", "sh", ["a"], offer("o1", "HX234", "2026-10-20T18:30:00+08:00", "2026-10-20T21:00:00+08:00"));
    const l2 = leg("hk", "sh", ["b"], offer("o2", "MU506", "2026-10-20T19:10:00+08:00", "2026-10-20T21:40:00+08:00"));
    const key = (legs: object) => planIssues({ members, stops, legs } as never)[0].key;
    expect(key({ l1, l2 })).toBe("split:l1:l2:o1:o2");
    expect(key({ l2, l1 })).toBe("split:l1:l2:o1:o2");
  });

  it("spots friends from different cities landing hours apart, and asks Pip to line them up", () => {
    const issues = planIssues({ members, stops, legs: {
      l1: leg("hk", "sh", ["a", "b"], offer("o1", "HX234", "2026-10-20T08:30:00+08:00", "2026-10-20T11:00:00+08:00")),
      l2: leg("sel", "sh", ["c"], offer("o2", "MF878", "2026-10-20T20:35:00+09:00", "2026-10-20T23:55:00+08:00", "SHA")),
    } } as never);
    expect(issues.map((i) => i.text)).toEqual(["Ann and Bo get to Shanghai at 11:00 AM (PVG) and Cy at 11:55 PM (SHA), 12h55 apart. Want me to line the arrivals up?"]);
    expect(issues[0].fixes[0]).toMatchObject({ kind: "ask", label: "Line them up" });
  });

  it("says nothing when arrivals are close or nothing's picked", () => {
    expect(planIssues({ members, stops, legs: {
      l1: leg("hk", "sh", ["a"], offer("o1", "HX234", "2026-10-20T18:30:00+08:00", "2026-10-20T21:00:00+08:00")),
      l2: leg("sel", "sh", ["c"], offer("o2", "MF878", "2026-10-20T19:00:00+09:00", "2026-10-20T22:00:00+08:00")),
      l3: leg("hk", "sh", ["b"], null),
    } } as never)).toEqual([]);
  });

  it("spots someone leaving early with no way home", () => {
    const issues = planIssues({ members: { ...members, b: { name: "Bo", color: 2, leaves: "2026-10-23" } }, stops, legs: {
      l1: leg("hk", "sh", ["a", "b"], null),
    } } as never);
    expect(issues).toEqual([{
      key: "home:b:2026-10-23:sh:hk",
      text: "Bo leaves Shanghai on Fri, Oct 23 but has no way home to Hong Kong yet. Should I add one?",
      fixes: [{ kind: "home", label: "Add Bo's way home", member: "b", from: "sh", to: "hk", date: "2026-10-23" }],
    }]);
  });
});
