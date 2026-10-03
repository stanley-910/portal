import { describe, expect, it } from "vitest";

import type { Mode, Offer, Segment } from "@/lib/transport/types";

import { credits, rowPrice, rowsFor, shortPlace, timeline, tripPrice, visibleTabs } from "./options";

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
  it("puts the best option first and the cheapest second, with badges", () => {
    const rows = rowsFor([direct("a", "flight", 200), direct("b", "train", 150), direct("c", "bus", 40), direct("d", "flight", 300)], "best", null);
    expect(rows.map((r) => [r.offer.id, r.badge])).toEqual([
      ["a", "Best"],
      ["c", "Lowest"],
      ["b", undefined],
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

  it("names unlisted connections and doesn't trust UTC arrivals for the time headline", () => {
    const o = offer("y", "flight", 120, [seg("flight", "Hong Kong", "Bangkok", "2026-10-04T09:00:00+08:00", "2026-10-04T03:45:00.000Z", 165)], { transfers: 1 });
    const [row] = rowsFor([o], "flight", null);
    expect(row.headline).toBe("Leaves 09:00");
    expect(row.description).toBe("Flight to Bangkok, 1 stop, 2h 45m");
  });

  it("keeps row text short and credits the provider once under the list", () => {
    const tp = "Travelpayouts / Aviasales — distance-based estimate; availability unverified";
    const to = (id: string, airport: string) =>
      offer(id, "flight", 165, [seg("flight", "Hong Kong", airport, "2026-10-04T09:00:00+08:00", "2026-10-04T13:00:00+09:00", 168)], {
        kind: "estimated",
        attribution: tp,
      });
    const rows = rowsFor([to("a", "Incheon International Airport"), to("b", "Seoul Gimpo International Airport")], "best", null);
    expect(rows.map((r) => r.description)).toEqual(["Flight to Incheon", "Flight to Seoul Gimpo"]);
    expect(rows[0].source).toContain(tp);
    expect(credits(rows)).toEqual([{ label: "Travelpayouts / Aviasales" }]);
    rows[1].offer.bookingUrl = "https://www.aviasales.com/search/b";
    expect(credits(rows, rows[1])).toEqual([{ label: "Travelpayouts / Aviasales", url: "https://www.aviasales.com/search/b" }]);
    expect(shortPlace("Airport")).toBe("Airport");
    expect(shortPlace("Shanghai Hongqiao")).toBe("Shanghai Hongqiao");
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
