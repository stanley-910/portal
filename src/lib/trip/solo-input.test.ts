import { describe, expect, it } from "vitest";

import type { Offer } from "@/lib/transport/types";

import { MAX_OFFERS } from "./offers";
import { returnLegPick, savedOptions, soloSaveInput, type LegPick } from "./solo-input";

const offer = (id: string): Offer => ({
  id,
  provider: "duffel",
  mode: "flight",
  kind: "live",
  segments: [
    {
      mode: "flight",
      from: { name: "Hong Kong", lat: 22.31, lng: 113.92 },
      to: { name: "Shanghai", lat: 31.14, lng: 121.81 },
      depart: "2099-10-04T08:00:00+08:00",
      arrive: "2099-10-04T10:30:00+08:00",
      durationMin: 150,
    },
  ],
  price: { amount: 120, currency: "USD" },
});
const HKG = { lat: 22.31, lng: 113.92, hub: "air:HKG", code: "HKG", name: "Hong Kong" };
const PVG = { lat: 31.14, lng: 121.81, hub: "air:PVG", code: "PVG", name: "Shanghai" };
const NRT = { lat: 35.77, lng: 140.39, hub: "air:NRT", code: "NRT", name: "Tokyo" };
const pick = (id: string, depart: string): LegPick => ({ offer: offer(id), offers: [offer(id), offer(`${id}2`)], depart, stay: null });

describe("savedOptions", () => {
  it("keeps the search's order, cut to what a room keeps, with the pick always in", () => {
    const many = Array.from({ length: MAX_OFFERS + 5 }, (_, i) => offer(`o${i}`));
    const kept = savedOptions(many[MAX_OFFERS + 2], many);
    expect(kept).toHaveLength(MAX_OFFERS);
    expect(kept.at(-1)!.id).toBe(`o${MAX_OFFERS + 2}`);
    expect(savedOptions(many[1], many.slice(0, 3)).map((o) => o.id)).toEqual(["o0", "o1", "o2"]);
    expect(savedOptions(many[0], []).map((o) => o.id)).toEqual(["o0"]);
  });
});

describe("soloSaveInput", () => {
  it("saves each leg with its pick, and a one-way trip as just its legs", () => {
    const input = soloSaveInput([{ from: HKG, to: PVG }], [{ ...pick("out", "2099-10-04"), stay: { label: "Hotel", nightly: { amount: 90, currency: "USD" }, estimated: true } }]);
    expect(input.legs).toHaveLength(1);
    expect(input.legs[0]).toMatchObject({ from: HKG, to: PVG, date: "2099-10-04", chosen: "out", stay: { label: "Hotel" } });
    expect(input.legs[0].offers.map((o) => o.id)).toEqual(["out", "out2"]);
  });

  it("turns a return into a leg from the last stop back to the first, on the return date, with its pick chosen", () => {
    const back = returnLegPick({ offer: offer("back"), offers: [offer("back0"), offer("back")], date: "2099-10-11" });
    expect(back).toEqual({ offer: offer("back"), offers: [offer("back0"), offer("back")], depart: "2099-10-11", stay: null });
    const input = soloSaveInput(
      [
        { from: HKG, to: PVG },
        { from: PVG, to: NRT },
      ],
      [pick("a", "2099-10-04"), pick("b", "2099-10-06"), back],
    );
    expect(input.legs).toHaveLength(3);
    const home = input.legs[2];
    expect(home).toEqual({ from: NRT, to: HKG, date: "2099-10-11", offers: [offer("back0"), offer("back")], chosen: "back" });
    expect(home).not.toHaveProperty("stay");
  });

  it("leaves a trip with no legs empty", () => {
    expect(soloSaveInput([], [pick("a", "2099-10-04")]).legs).toEqual([]);
  });
});
