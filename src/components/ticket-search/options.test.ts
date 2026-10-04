import { describe, expect, it } from "vitest";

import type { Mode, Offer, Segment } from "@/lib/transport/types";

import { clockOf, rowPrice, rowsFor, shortPlace, SHOWN, timeline, tripPrice, visibleTabs } from "./options";

const place = (name: string) => ({ name, lat: 0, lng: 0 });
const seg = (mode: Mode, from: string, to: string, depart: string, arrive: string, durationMin: number): Segment => ({
  mode,
  from: place(from),
  to: place(to),
  depart,
  arrive,
  durationMin,
});
const offer = (id: string, mode: Mode, amount: number | null, segments: Segment[], extra: Partial<Offer> = {}): Offer => ({
  id,
  provider: "travelpayouts",
  mode,
  segments,
  price: amount === null ? undefined : { amount, currency: "USD" },
  kind: "cached",
  ...extra,
});

const direct = (id: string, mode: Mode, amount: number | null) =>
  offer(id, mode, amount, [seg(mode, "Hong Kong", "Shanghai", "2026-10-04T08:00:00+08:00", "2026-10-04T16:00:00+08:00", 480)]);

describe("ticket search options", () => {
  it("keeps the selected fare visible when a later batch outranks it", () => {
    const chosen = direct("chosen", "flight", 900);
    // more ranked above it than a tab lists
    const late = [...Array.from({ length: SHOWN }, (_, i) => direct(`o${i}`, "flight", 100 + i)), chosen];
    expect(rowsFor(late, "best", null).map((r) => r.offer.id)).not.toContain(chosen.id);
    const rows = rowsFor(late, "best", null, chosen.id);
    expect(rows).toHaveLength(SHOWN);
    expect(rows.map((r) => r.offer.id)).toContain(chosen.id);
    expect(rows.find((r) => r.offer.id === chosen.id)?.offer).toBe(chosen);
  });
  it("puts the best option first and the cheapest second, with badges", () => {
    const rows = rowsFor([direct("a", "flight", 200), direct("b", "train", 150), direct("c", "bus", 40), direct("d", "flight", 300)], "best", null);
    expect(rows.map((r) => [r.offer.id, r.badge])).toEqual([
      ["a", "Best"],
      ["c", "Lowest"],
      ["b", undefined],
      ["d", undefined],
    ]);
  });

  it("shows only Best and the modes with results", () => {
    expect(visibleTabs([direct("a", "flight", 1), direct("b", "train", 1)])).toEqual(["best", "flight", "train"]);
  });

  it("draws a layover between listed segments", () => {
    const legs = timeline(
      offer("x", "flight", 905, [
        seg("flight", "São Paulo", "Addis Ababa", "2026-10-04T23:10:00-03:00", "2026-10-05T15:20:00+03:00", 610),
        seg("flight", "Addis Ababa", "Lagos", "2026-10-05T17:05:00+03:00", "2026-10-05T18:50:00+01:00", 225),
      ]),
    );
    expect(legs.map((l) => [l.kind, l.minutes])).toEqual([
      ["flight", 610],
      ["wait", 105],
      ["flight", 225],
    ]);
    expect(legs[1].label).toBe("Layover 1h 45m in Addis Ababa");
  });

  it("names unlisted connections, and works the arrival out from the duration when the provider's is in UTC", () => {
    const o = offer("y", "flight", 120, [seg("flight", "Hong Kong", "Bangkok", "2026-10-04T09:00:00+08:00", "2026-10-04T03:45:00.000Z", 165)], { transfers: 1 });
    for (const tab of ["best", "flight"] as const) {
      const [row] = rowsFor([o], tab, null);
      // the same on every tab: the duration up top, who and where under it, the times on the timeline
      expect(row.headline).toBe("2h 45m");
      expect(row.description).toBe("Flight to Bangkok, 1 stop");
      expect(row.clock).toEqual({ departs: "09:00", arrives: "11:45", approx: true, days: 0 });
    }
  });

  it("keeps row text short and says where each row is from", () => {
    const tp = "Travelpayouts / Aviasales — distance-based estimate; availability unverified";
    const to = (id: string, airport: string) =>
      offer(id, "flight", 165, [seg("flight", "Hong Kong", airport, "2026-10-04T09:00:00+08:00", "2026-10-04T13:00:00+09:00", 168)], {
        kind: "estimated",
        attribution: tp,
      });
    const rows = rowsFor([to("a", "Incheon International Airport"), to("b", "Seoul Gimpo International Airport")], "best", null);
    expect(rows.map((r) => r.description)).toEqual(["Flight to Incheon", "Flight to Seoul Gimpo"]);
    expect(rows[0].source).toContain(tp);
    expect(shortPlace("Airport")).toBe("Airport");
    expect(shortPlace("Shanghai Hongqiao")).toBe("Shanghai Hongqiao");
  });

  it.each([
    ["2026-11-15T23:00:00+08:00", "2026-11-16T05:00:00+00:00", "+1"],
    ["2026-11-15T00:30:00+09:00", "2026-11-14T17:30:00-08:00", "-1"],
    ["2026-11-15T23:00:00-08:00", "2026-11-17T05:00:00+09:00", "+2"],
  ])("counts the days to a local arrival across midnight and the date line", (depart, arrive, offset) => {
    const o = offer("overnight", "flight", 900, [seg("flight", "Origin", "Destination", depart, arrive, 600)], { kind: "live" });
    const [row] = rowsFor([o], "flight", null);
    expect(row.clock?.approx).toBe(false);
    expect(row.clock?.days).toBe(Number(offset));
    // a modelled option has no schedule to show
    expect(rowsFor([{ ...o, kind: "estimated" }], "flight", null)[0].clock).toBeNull();
  });

  it("works an arrival past midnight out from the departure", () => {
    expect(clockOf("2026-11-15T22:30:00+08:00", "2026-11-16T01:00:00Z", 150, false)).toEqual({ departs: "22:30", arrives: "01:00", approx: true, days: 1 });
    expect(clockOf("2026-11-15T22:30:00Z", "2026-11-16T01:00:00Z", 150, false)).toBeNull();
  });

  it("prices one option, and a round trip as both picks together", () => {
    const out = direct("a", "train", 100);
    const back = direct("r1", "flight", 70);
    expect(rowPrice(out, "USD", null)).toBe(100);
    expect(tripPrice([out, back], "USD", null)).toBe(170);
    expect(tripPrice([out, { ...back, price: undefined }], "USD", null)).toBeNull();
    expect(tripPrice([], "USD", null)).toBeNull();
  });
});
