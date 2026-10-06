import { describe, expect, it } from "vitest";
import { storedFlights, type StoredPlan } from "./stored-flights";

const offer = (id: string, mode: "flight" | "train" | "bus" | "ferry") => ({ id, mode });
const plan = (chosen: string | null): StoredPlan => ({
  stops: { a: { lat: 22.3, lng: 114.17 }, b: { lat: 31.23, lng: 121.47 } },
  legs: {
    l1: { from: "a", to: "b", createdBy: "u1", chosen, search: { offers: [offer("o1", "flight"), offer("o2", "train")] } },
  },
  members: { u1: { color: 3 } },
});

describe("storedFlights", () => {
  it("parks each leg as its chosen offer's vehicle", () => {
    expect(storedFlights(plan("o2"))).toEqual([
      expect.objectContaining({ id: "leg:l1", landed: true, vehicle: "train", at: { lat: 31.23, lng: 121.47 } }),
    ]);
  });

  it("parks a plane when nothing is chosen or the choice is gone", () => {
    expect(storedFlights(plan(null))[0].vehicle).toBe("flight");
    expect(storedFlights(plan("missing"))[0].vehicle).toBe("flight");
  });

  it("routes a leg through its chosen option's connections, and direct until one is chosen", () => {
    const yvr = { code: "YVR", lat: 49.19, lng: -123.18 };
    const base = plan("o1");
    const connecting = { ...base, legs: { l1: { ...base.legs.l1, search: { offers: [{ ...offer("o1", "flight"), layovers: [yvr] }] } } } };
    expect(storedFlights(connecting)[0].layovers).toEqual([yvr]);
    expect(storedFlights({ ...connecting, legs: { l1: { ...connecting.legs.l1, chosen: null } } })[0]).not.toHaveProperty("layovers");
  });

  it("tints each leg in its drawer's colour slot, ink when they've left", () => {
    expect(storedFlights(plan(null))[0].color).toBe(2);
    expect(storedFlights({ ...plan(null), members: {} })[0].color).toBeNull();
  });

  it("skips legs whose stops are missing", () => {
    expect(storedFlights({ ...plan(null), stops: {} })).toEqual([]);
  });
});
