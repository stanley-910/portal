import { describe, expect, it } from "vitest";
import type { Route } from "@/lib/transport/compose";
import { pickGroup, planGroup, type Traveller } from "./group";

const who = (id: string): Traveller => ({ id, name: id, from: { name: id, lat: 0, lng: 0 } });
const route = (id: string, arrive: string, amount: number | null): Route => ({
  id, type: "direct", via: null, parts: [{ mode: "train", carrier: id, number: id, from: { name: "a", lat: 0, lng: 0 }, to: { name: "b", lat: 0, lng: 0 },
    depart: arrive, arrive, price: amount === null ? null : { amount, currency: "USD" }, kind: "timetable", provider: "china-rail", flexible: false, offerId: id }],
  depart: arrive, arrive, durationMin: 60, total: amount === null ? null : { amount, currency: "USD", converted: false }, saves: null, gapMin: null, estimated: true,
});

describe("pickGroup", () => {
  it("takes the cheapest mix that still gets everyone in together", () => {
    const picks = pickGroup([
      // Ann's cheapest gets in at 10:00, hours before Bo can
      { member: who("ann"), routes: [route("ann-early", "2026-10-20T10:00:00+08:00", 50), route("ann-late", "2026-10-20T19:00:00+08:00", 70)] },
      { member: who("bo"), routes: [route("bo", "2026-10-20T19:30:00+08:00", 100)] },
    ]);
    expect(picks?.map((p) => p.route.id)).toEqual(["ann-late", "bo"]);
  });

  it("takes the cheapest when nothing gets everyone in together", () => {
    const picks = pickGroup([
      { member: who("ann"), routes: [route("ann-a", "2026-10-20T06:00:00+08:00", 50), route("ann-b", "2026-10-20T08:00:00+08:00", 80)] },
      { member: who("bo"), routes: [route("bo", "2026-10-20T20:00:00+08:00", 100)] },
    ]);
    expect(picks?.map((p) => p.route.id)).toEqual(["ann-a", "bo"]);
  });

  it("keeps to an arrival time when one is given", () => {
    const picks = pickGroup([
      { member: who("ann"), routes: [route("cheap-late", "2026-10-20T21:00:00+08:00", 40), route("on-time", "2026-10-20T17:00:00+08:00", 90)] },
    ], { arriveBy: "2026-10-20T18:00:00+08:00" });
    expect(picks?.[0].route.id).toBe("on-time");
  });

  it("prefers a priced route over an unpriced one", () => {
    const picks = pickGroup([{ member: who("ann"), routes: [route("no-fare", "2026-10-20T10:00:00+08:00", null), route("fare", "2026-10-20T10:30:00+08:00", 300)] }]);
    expect(picks?.[0].route.id).toBe("fare");
  });
});

describe("planGroup", () => {
  it("searches again lined up with the latest arrival when the cheapest mix lands far apart", async () => {
    const asked: { from: string; arriveNear?: string }[] = [];
    const plan = await planGroup({ travellers: [who("ann"), who("bo")], to: { name: "Shanghai", lat: 31, lng: 121 }, date: "2026-10-20", currency: "USD" },
      async (input) => {
        asked.push({ from: input.from.name, arriveNear: input.arriveNear });
        if (input.from.name === "bo") return { baseline: route("bo", "2026-10-20T19:30:00+08:00", 100), routes: [], gateways: [], searched: 1 };
        // Ann only finds an evening train once asked to line up
        return input.arriveNear
          ? { baseline: null, routes: [route("ann-evening", "2026-10-20T19:00:00+08:00", 70)], gateways: [], searched: 1 }
          : { baseline: route("ann-morning", "2026-10-20T10:00:00+08:00", 50), routes: [], gateways: [], searched: 1 };
      });
    expect(asked).toContainEqual({ from: "ann", arriveNear: "2026-10-20T19:30:00+08:00" });
    expect(plan.picks.map((p) => p.route.id)).toEqual(["ann-evening", "bo"]);
    expect(plan.total).toEqual({ amount: 170, currency: "USD", converted: false });
    expect(plan.spreadMin).toBe(30);
  });

  it("names a member nobody found a way for", async () => {
    const plan = await planGroup({ travellers: [who("ann")], to: { name: "x", lat: 0, lng: 0 }, date: "2026-10-20", currency: "USD" },
      async () => { throw new Error("down"); });
    expect(plan.missing.map((m) => m.member.id)).toEqual(["ann"]);
  });
});

describe("groupOps", async () => {
  const { groupOps } = await import("./tools");
  const { handlesFor } = await import("./snapshot");
  const stop = (name: string, lat: number, lng: number) => ({ name, lat, lng, hub: null, code: null });
  const leg = (from: string, to: string, riders: string[], createdAt: number) => ({ from, to, date: "2026-10-20", riders, createdAt, createdBy: "a", votes: {}, chosen: null, search: { id: "s", status: "done" as const, offers: [] } });
  const plan = {
    members: { a: { name: "Ann", color: 1 }, b: { name: "Bo", color: 2 }, c: { name: "Cy", color: 3 } },
    stops: { hk: stop("Hong Kong", 22.3, 114.17), sh: stop("Shanghai", 31.23, 121.47), sel: stop("Seoul", 37.56, 126.97) },
    legs: { l1: leg("hk", "sh", ["a", "b"], 1), l2: leg("sel", "sh", ["c"], 2) },
  };
  const h = handlesFor(plan as never);
  const via = { name: "Shenzhen North", lat: 22.61, lng: 114.03 };
  const pick = (id: string, through: typeof via | null) => ({ member: who(id), route: { ...route(id, "2026-10-20T19:00:00+08:00", 100), via: through, type: through ? "via" as const : "direct" as const, depart: "2026-10-20T09:00:00+08:00" } });
  const travellers = [{ id: "a", startId: "hk", there: "l1" }, { id: "b", startId: "hk", there: "l1" }, { id: "c", startId: "sel", there: "l2" }];
  const meet = { stop: h.stop.get("sh")! };

  it("puts members taking the same way on the same legs and retires the leg they leave", () => {
    const ops = groupOps([pick("a", via), pick("b", via), pick("c", null)], travellers, meet, plan as never, h);
    const [m1, m2, l1] = [h.member.get("a"), h.member.get("b"), h.leg.get("l1")];
    expect(ops).toEqual([
      { op: "add_leg", from: { stop: h.stop.get("hk") }, to: { at: { ...stop("Shenzhen North", 22.61, 114.03) } }, date: "2026-10-20", riders: [m1, m2] },
      { op: "add_leg", from: { at: { ...stop("Shenzhen North", 22.61, 114.03) } }, to: meet, date: "2026-10-20", riders: [m1, m2] },
      { op: "remove_leg", leg: l1 },
    ]);
  });

  it("keeps the others on a leg one member leaves", () => {
    const ops = groupOps([pick("a", via), pick("b", null)], travellers, meet, plan as never, h);
    expect(ops.at(-1)).toEqual({ op: "set_riders", leg: h.leg.get("l1"), riders: [h.member.get("b")] });
  });

  it("adds a direct leg only for someone with none there yet", () => {
    const ops = groupOps([pick("c", null)], [{ id: "c", startId: "sel", there: null }], meet, plan as never, h);
    expect(ops).toEqual([{ op: "add_leg", from: { stop: h.stop.get("sel") }, to: meet, date: "2026-10-20", riders: [h.member.get("c")] }]);
  });
});
