import { describe, expect, it } from "vitest";

import { bigCities, findMeetup, shortlist, type MeetupQuery } from "@/lib/agent/meetup";
import type { Offer, SearchQuery } from "@/lib/transport/types";

const hk = { name: "Hong Kong", lat: 22.3036, lng: 114.165, hub: null, code: null };
const seoul = { name: "Seoul", lat: 37.4602, lng: 126.4407, hub: null, code: null };

const query = (over: Partial<MeetupQuery> = {}): MeetupQuery => ({
  groups: [
    { members: ["a", "b"], people: 2, stopId: "s1", place: hk },
    { members: ["c"], people: 1, stopId: null, place: seoul },
  ],
  date: "2026-11-14",
  minimize: "price",
  fairest: false,
  candidates: [],
  ...over,
});

const fare = (q: SearchQuery, usd: number, kind: Offer["kind"] = "cached"): Offer => ({
  id: `t:${q.to.name}`,
  provider: "travelpayouts",
  mode: "flight",
  kind,
  price: { amount: usd, currency: "USD" },
  segments: [{ mode: "flight", from: q.from, to: q.to, depart: "2026-11-14T08:00:00+08:00", arrive: "2026-11-14T10:00:00+08:00", durationMin: 120 }],
});

describe("shortlist", () => {
  it("never meets at a group's own city", () => {
    const names = shortlist(query()).map((s) => s.city.name);
    expect(names).not.toContain("Hong Kong");
    expect(names).not.toContain("Seoul");
  });

  it("puts the fairest pick between the groups", () => {
    const [best] = shortlist(query({ fairest: true }));
    // between HK and Seoul: roughly the East China Sea coast
    expect(best.city.lat).toBeGreaterThan(24);
    expect(best.city.lat).toBeLessThan(36);
  });

  it("keeps to named candidates", () => {
    const names = shortlist(query({ candidates: ["Shanghai", "Taipei"] })).map((s) => s.city.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => /Shanghai|Taipei/.test(n))).toBe(true);
  });
});

describe("findMeetup", () => {
  it("ranks verified fares, totals by head count and counts estimates", async () => {
    const prices: Record<string, number> = { Shanghai: 100, Taipei: 80 };
    const result = await findMeetup(query({ candidates: ["Shanghai", "Taipei"] }), async (q) => [
      fare(q, prices[q.to.name.replace(/ .*/, "")] ?? 500, q.from.name === "Seoul" ? "estimated" : "cached"),
    ]);
    expect(result.options[0].place.name).toMatch(/Taipei/);
    expect(result.options[0].total).toEqual({ amount: 240, currency: "USD" });
    expect(result.options[0].estimated).toBe(1);
    expect(result.options[0].id).toBe("P1");
  });

  it("drops a city some group can't reach", async () => {
    const result = await findMeetup(query({ candidates: ["Shanghai", "Taipei"] }), async (q) =>
      q.to.name.startsWith("Taipei") && q.from.name === "Seoul" ? [] : [fare(q, 100)],
    );
    expect(result.options.map((o) => o.place.name).some((n) => n.startsWith("Taipei"))).toBe(false);
  });

  it("has big cities to choose from", () => {
    expect(bigCities().length).toBeGreaterThan(100);
  });
});
