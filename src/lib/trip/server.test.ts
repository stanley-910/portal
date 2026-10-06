import { describe, expect, it } from "vitest";

import type { Offer } from "@/lib/transport/types";

import { buildSoloStorage, MAX_SOLO_LEGS, soloLegSchema, soloSaveSchema, toStorageLson, toTripSummaries } from "./server";
import { computeSplit, type SplitInput } from "./split";
import { planTitle } from "./title";

const room = (id: string, metadata: Record<string, string | string[]>, createdAt = "2026-10-01T00:00:00.000Z", lastConnectionAt?: string) => ({
  id,
  metadata,
  createdAt: new Date(createdAt),
  ...(lastConnectionAt ? { lastConnectionAt: new Date(lastConnectionAt) } : {}),
});

describe("toTripSummaries", () => {
  it("strips the room prefix, maps fields and sorts newest first", () => {
    const out = toTripSummaries([
      room("trip:aaaaaaaaaaaaaaaa", { title: "Old", members: ["u1"], updatedAt: "2026-10-02T00:00:00.000Z" }),
      room("trip:bbbbbbbbbbbbbbbb", { title: "New", members: ["u1", "u2"], updatedAt: "2026-10-03T00:00:00.000Z" }),
    ]);
    expect(out.map((t) => t.id)).toEqual(["bbbbbbbbbbbbbbbb", "aaaaaaaaaaaaaaaa"]);
    expect(out[0]).toEqual({ id: "bbbbbbbbbbbbbbbb", title: "New", members: 2, updatedAt: "2026-10-03T00:00:00.000Z" });
  });

  it("falls back to 'New trip' when the title is missing", () => {
    expect(toTripSummaries([room("trip:cccccccccccccccc", { members: ["u1"] })])[0].title).toBe("New trip");
  });

  it("counts members given as a string or an array", () => {
    const out = toTripSummaries([
      room("trip:a", { members: "u1" }, "2026-10-01T00:00:00.000Z"),
      room("trip:b", { members: ["u1", "u2", "u3"] }, "2026-10-02T00:00:00.000Z"),
    ]);
    expect(out.find((t) => t.id === "a")?.members).toBe(1);
    expect(out.find((t) => t.id === "b")?.members).toBe(3);
  });

  it("uses updatedAt, then lastConnectionAt, then createdAt", () => {
    const [a, b, c] = toTripSummaries([
      room("trip:a", { updatedAt: "2026-10-05T00:00:00.000Z" }, "2026-10-01T00:00:00.000Z", "2026-10-04T00:00:00.000Z"),
      room("trip:b", {}, "2026-10-01T00:00:00.000Z", "2026-10-04T00:00:00.000Z"),
      room("trip:c", {}, "2026-10-01T00:00:00.000Z"),
    ]);
    expect([a.updatedAt, b.updatedAt, c.updatedAt]).toEqual([
      "2026-10-05T00:00:00.000Z",
      "2026-10-04T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    ]);
  });
});

const seg = {
  mode: "flight" as const,
  carrier: "Cathay Pacific",
  from: { name: "Hong Kong", lat: 22.31, lng: 113.92, iata: "HKG" },
  to: { name: "Shanghai", lat: 31.14, lng: 121.81, iata: "PVG" },
  depart: "2099-10-04T08:00:00+08:00",
  arrive: "2099-10-04T10:30:00+08:00",
  durationMin: 150,
};
const offer = (id: string, patch: Partial<Offer> = {}): Offer => ({
  id,
  provider: "travelpayouts",
  mode: "flight",
  kind: "cached",
  segments: [seg],
  price: { amount: 120, currency: "USD" },
  bookingUrl: "https://example.com/book",
  ...patch,
});
const HKG = { lat: 22.31, lng: 113.92, hub: "air:HKG", code: "HKG", name: "Hong Kong" };
const PVG = { lat: 31.14, lng: 121.81, hub: "air:PVG", code: "PVG", name: "Shanghai" };
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const input = { from: HKG, to: PVG, date: tomorrow, offers: [offer("tp:a"), offer("tp:b")], chosen: "tp:b" };
const user = { id: "u1", displayName: "Ada" };
// ids in the order the builder asks: each new stop, then the leg and its search
const ids = () => {
  const queue = ["s1", "s2", "l1", "q1", "s3", "l2", "q2"];
  return () => queue.shift()!;
};
const save = (...legs: object[]) => soloSaveSchema.parse({ legs });
const solo = () => buildSoloStorage(save(input), user, ids(), 1_000);

const hasUndefined = (v: unknown): boolean =>
  v === undefined || (typeof v === "object" && v !== null && Object.values(v).some(hasUndefined));

describe("buildSoloStorage", () => {
  it("holds one done leg with the picked offer chosen and the saver as member colour 1", () => {
    const doc = solo();
    expect(doc.members).toEqual({ u1: { name: "Ada", color: 1 } });
    expect(doc.stops).toEqual({ s1: HKG, s2: PVG });
    expect(doc.legs.l1).toMatchObject({
      from: "s1",
      to: "s2",
      date: tomorrow,
      createdBy: "u1",
      riders: ["u1"],
      votes: {},
      chosen: "tp:b",
      createdAt: 1_000,
    });
    expect(doc.legs.l1.search.id).toBe("q1");
    expect(doc.legs.l1.search.status).toBe("done");
    expect(doc.legs.l1.search.offers.map((o) => o.id)).toEqual(["tp:a", "tp:b"]);
    expect(doc.legs.l1.search.offers[1]).toMatchObject({ kind: "cached", carrier: "Cathay Pacific", bookingUrl: "https://example.com/book" });
    expect(planTitle(doc)).toBe("Hong Kong → Shanghai");
  });

  it("keeps a saved offer's airline code", () => {
    const coded = offer("tp:c", { segments: [{ ...seg, carrierCode: "CX" }] });
    const doc = buildSoloStorage(save({ ...input, offers: [coded], chosen: "tp:c" }), user, ids(), 1_000);
    expect(doc.legs.l1.search.offers[0].carrierCode).toBe("CX");
    expect(() => save({ ...input, offers: [offer("tp:d", { segments: [{ ...seg, carrierCode: "<script>" }] })] })).toThrow();
  });

  it("keeps a snapped end on its leg, not on the stop legs share", () => {
    const doc = buildSoloStorage(save({ ...input, to: { ...PVG, snapped: true } }), user, ids(), 1_000);
    expect(doc.stops.s2).toEqual(PVG);
    expect(doc.legs.l1.snap).toEqual({ to: "air:PVG" });
    expect(solo().legs.l1).not.toHaveProperty("snap");
  });

  it("stores a stop without a code as null", () => {
    const noCode: Partial<typeof HKG> = { ...HKG };
    delete noCode.code;
    const doc = buildSoloStorage(save({ ...input, from: noCode }), user, ids(), 1);
    expect(doc.stops.s1.code).toBeNull();
  });

  it("saves a picked hotel as the saver's stay at the destination, marked estimated", () => {
    const stay = { label: "4★ hotel, Nanjing Road", nightly: { amount: 112, currency: "USD" } };
    const doc = buildSoloStorage(save({ ...input, stay }), user, ids(), 1);
    const leg = Object.values(doc.legs)[0]!;
    // one night from the leg's day, with no leg out of there yet
    expect(Object.values(doc.stays!)).toEqual([
      { stop: "s2", checkIn: leg.date, checkOut: expect.any(String), guests: ["u1"], ...stay, estimated: true, createdAt: 1 },
    ]);
    expect(Object.values(doc.stays!)[0]!.checkOut! > leg.date).toBe(true);
    const lson = toStorageLson(doc).data as Record<string, { liveblocksType: string }>;
    expect(lson.stays.liveblocksType).toBe("LiveMap");
  });

  it("chains legs through a shared stop, in the order they were flown", () => {
    const NRT = { lat: 35.77, lng: 140.39, hub: "air:NRT", code: "NRT", name: "Tokyo" };
    const after = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const next = { from: PVG, to: NRT, date: after, offers: [offer("tp:c")], chosen: "tp:c" };
    const doc = buildSoloStorage(save(input, next), user, ids(), 1_000);
    expect(doc.stops).toEqual({ s1: HKG, s2: PVG, s3: NRT });
    expect(doc.legs.l2).toMatchObject({ from: "s2", to: "s3", date: after, chosen: "tp:c", createdAt: 1_001 });
    expect(soloSaveSchema.safeParse({ legs: [next, input] }).success).toBe(false);
    expect(soloSaveSchema.safeParse({ legs: [] }).success).toBe(false);
  });

  it("keeps a live hotel rate unmarked as estimated", () => {
    const stay = { label: "Hotel Nikko", nightly: { amount: 980, currency: "CNY" }, estimated: false };
    expect(Object.values(buildSoloStorage(save({ ...input, stay }), user, ids(), 1).stays!)[0]).toMatchObject({ stop: "s2", ...stay });
  });

  it("leaves stays out when no hotel was picked", () => {
    expect(solo().stays).toBeUndefined();
    expect((toStorageLson(solo()).data as Record<string, unknown>).stays).toBeUndefined();
  });
});

describe("a round trip saved from /", () => {
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const counter = () => {
    let n = 0;
    return () => `id${n++}`;
  };
  const out = { ...input, date: day(1) };
  const back = { from: PVG, to: HKG, date: day(5), offers: [offer("duffel:back", { provider: "duffel", kind: "live" }), offer("tp:back")], chosen: "duffel:back" };

  it("stores the way back as a leg home through the same stops, its pick chosen", () => {
    const doc = buildSoloStorage(save(out, back), user, counter(), 1_000);
    expect(Object.keys(doc.stops)).toHaveLength(2);
    const [first, home] = Object.values(doc.legs);
    expect(home).toMatchObject({ from: first.to, to: first.from, date: day(5), chosen: "duffel:back", riders: ["u1"], createdAt: 1_001 });
    // a Duffel pick stays a Duffel offer, so the room can settle it
    expect(home.search.offers.find((o) => o.id === home.chosen)).toMatchObject({ provider: "duffel", kind: "live" });
    expect(planTitle(doc)).toContain("Shanghai");
  });

  it("ends the nights at the last stop on the return date, with none at home", () => {
    const stay = { label: "Hotel", nightly: { amount: 100, currency: "USD" } };
    const doc = buildSoloStorage(save({ ...out, stay }, back), user, counter(), 1_000);
    const split = computeSplit(doc as SplitInput);
    const shanghai = Object.entries(doc.stops).find(([, s]) => s.name === "Shanghai")![0];
    expect(split.members.u1.nightShares.map((n) => [n.stop, n.date])).toEqual([1, 2, 3, 4].map((n) => [shanghai, day(n)]));
    expect(split.members.u1.totals).toEqual({ USD: 120 + 120 + 400 });
  });

  it("refuses a way back before the way out", () => {
    expect(soloSaveSchema.safeParse({ legs: [out, { ...back, date: day(0) }] }).success).toBe(false);
  });

  it("takes eight flown legs and the way back, and no more", () => {
    const loop = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ...input, date: day(1 + i), ...(i % 2 ? { from: PVG, to: HKG } : {}) }));
    expect(soloSaveSchema.safeParse({ legs: loop(MAX_SOLO_LEGS) }).success).toBe(true);
    expect(MAX_SOLO_LEGS).toBe(9);
    expect(soloSaveSchema.safeParse({ legs: loop(MAX_SOLO_LEGS + 1) }).success).toBe(false);
  });
});

describe("toStorageLson", () => {
  it("nests main's TripStorage as LiveObjects in LiveMaps, votes a LiveMap, no undefined", () => {
    const lson = toStorageLson(solo());
    expect(lson.liveblocksType).toBe("LiveObject");
    const data = lson.data as Record<string, { liveblocksType: string; data: Record<string, { liveblocksType: string; data: Record<string, unknown> }> }>;
    for (const key of ["members", "stops", "legs"]) expect(data[key].liveblocksType).toBe("LiveMap");
    expect(data.members.data.u1).toEqual({ liveblocksType: "LiveObject", data: { name: "Ada", color: 1 } });
    expect(data.stops.data.s1).toEqual({ liveblocksType: "LiveObject", data: HKG });
    const leg = data.legs.data.l1;
    expect(leg.liveblocksType).toBe("LiveObject");
    expect(leg.data.votes).toEqual({ liveblocksType: "LiveMap", data: {} });
    expect(leg.data.chosen).toBe("tp:b");
    expect((leg.data.search as { status: string }).status).toBe("done");
    expect(hasUndefined(lson)).toBe(false);
  });
});

describe("soloLegSchema", () => {
  const rejects = (patch: object) => expect(soloLegSchema.safeParse({ ...input, ...patch }).success).toBe(false);

  it("accepts a landed leg and strips unknown fields", () => {
    const r = soloLegSchema.parse({ ...input, evil: 1, offers: [{ ...offer("tp:b"), evil: "<script>" }] });
    expect(r).not.toHaveProperty("evil");
    expect(r.offers[0]).not.toHaveProperty("evil");
  });

  it("rejects bad dates", () => {
    rejects({ date: "2020-01-01" });
    rejects({ date: "2999-01-01" });
    rejects({ date: "4 Oct" });
  });

  it("rejects the same place twice and malformed stops", () => {
    rejects({ to: HKG });
    rejects({ from: { ...HKG, lat: 200 } });
    rejects({ from: { ...HKG, name: "" } });
    rejects({ from: { ...HKG, name: "x".repeat(200) } });
    rejects({ to: { code: "PVG" } });
  });

  it("rejects a chosen id that isn't an option, and duplicate options", () => {
    rejects({ chosen: "tp:zzz" });
    rejects({ offers: [offer("tp:b"), offer("tp:b")] });
    rejects({ offers: [] });
    rejects({ offers: Array.from({ length: 21 }, (_, i) => offer(`tp:${i}`)), chosen: "tp:0" });
  });

  it("rejects forged or oversized offers", () => {
    const bad = (patch: Partial<Record<keyof Offer, unknown>>) => rejects({ offers: [offer("tp:b", patch as Partial<Offer>)] });
    bad({ kind: "guaranteed" });
    bad({ provider: "evil" });
    bad({ segments: [] });
    bad({ segments: Array(9).fill(seg) });
    bad({ bookingUrl: "javascript:alert(1)" });
    bad({ attribution: "x".repeat(20_000) });
    bad({ price: { amount: -1, currency: "USD" } });
    bad({ segments: [{ ...seg, depart: "soon" }] });
    rejects({ offers: "not an offer" });
    expect(soloSaveSchema.safeParse("nope").success).toBe(false);
    expect(soloSaveSchema.safeParse(input).success).toBe(false);
  });
});
