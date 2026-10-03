import { describe, expect, it } from "vitest";
import { storedFlights, type StoredPlan } from "./stored-flights";

const offer = (id: string, mode: "flight" | "train" | "bus" | "ferry") => ({ id, mode });
const plan = (chosen: string | null): StoredPlan => ({
  stops: { a: { lat: 22.3, lng: 114.17 }, b: { lat: 31.23, lng: 121.47 } },
  legs: {
    l1: { from: "a", to: "b", chosen, search: { offers: [offer("o1", "flight"), offer("o2", "train")] } },
  },
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

  it("skips legs whose stops are missing", () => {
    expect(storedFlights({ ...plan(null), stops: {} })).toEqual([]);
  });
});
