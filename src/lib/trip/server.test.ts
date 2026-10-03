import { describe, expect, it } from "vitest";

import type { Offer } from "@/lib/transport/types";

import { buildSoloStorage, soloSaveSchema, toStorageLson, toTripSummaries } from "./server";
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
const ids = { from: "s1", to: "s2", leg: "l1", search: "q1" };
const solo = () => buildSoloStorage(soloSaveSchema.parse(input), user, ids, 1_000);

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

  it("stores a stop without a code as null", () => {
    const noCode: Partial<typeof HKG> = { ...HKG };
    delete noCode.code;
    const doc = buildSoloStorage(soloSaveSchema.parse({ ...input, from: noCode }), user, ids, 1);
    expect(doc.stops.s1.code).toBeNull();
  });

  it("saves a picked hotel as the destination's stay, marked estimated", () => {
    const stay = { label: "4★ hotel, Nanjing Road", nightly: { amount: 112, currency: "USD" } };
    const doc = buildSoloStorage(soloSaveSchema.parse({ ...input, stay }), user, ids, 1);
    expect(doc.stays).toEqual({ s2: { ...stay, estimated: true } });
    const lson = toStorageLson(doc).data as Record<string, { liveblocksType: string }>;
    expect(lson.stays.liveblocksType).toBe("LiveMap");
  });

  it("leaves stays out when no hotel was picked", () => {
    expect(solo().stays).toBeUndefined();
    expect((toStorageLson(solo()).data as Record<string, unknown>).stays).toBeUndefined();
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

describe("soloSaveSchema", () => {
  const rejects = (patch: object) => expect(soloSaveSchema.safeParse({ ...input, ...patch }).success).toBe(false);

  it("accepts a landed leg and strips unknown fields", () => {
    const r = soloSaveSchema.parse({ ...input, evil: 1, offers: [{ ...offer("tp:b"), evil: "<script>" }] });
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
  });
});
