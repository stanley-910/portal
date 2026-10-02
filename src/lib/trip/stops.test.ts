import { describe, expect, it } from "vitest";

import type { Hub } from "@/lib/transport/hubs/types";
import { sameStop, stopFromPoint, stopToPlace } from "./stops";

const airport: Hub = {
  id: "airport:VHHH", code: "HKG", iata: "HKG", name: "Hong Kong International Airport",
  city: "Hong Kong", mode: "flight", lat: 22.308, lng: 113.9185, importance: 3, source: "test",
};
const point = { lat: 22.30123456, lng: 114.17123456 };

describe("shared trip stops", () => {
  it("preserves the exact click rather than snapping to the preview airport", () => {
    const stop = stopFromPoint(point, airport);
    expect(stop).toEqual({ ...point, hub: "airport:VHHH", code: "HKG", name: "Hong Kong" });
    expect(stopToPlace(stop)).toEqual({ ...point, name: "Hong Kong" });
  });

  it("keeps rail identity separate from its display code and airport IATA", () => {
    const station: Hub = {
      ...airport, id: "rail:hk-west-kowloon", code: "WEK", iata: undefined, mode: "train",
      name: "Hong Kong West Kowloon",
    };
    const stop = stopFromPoint(point, station);
    expect(stop.hub).toBe(station.id);
    expect(stop.code).toBe("WEK");
    expect(stopToPlace(stop)).not.toHaveProperty("iata");
    expect(sameStop(stop, stopFromPoint(point, airport))).toBe(false);
  });

  it("stores and searches outside-coverage points without a hub", () => {
    const ocean = { lat: -0.12345678, lng: -140.98765432 };
    const stop = stopFromPoint(ocean, null);
    expect(stop).toEqual({ ...ocean, hub: null, code: null, name: "-0.1235, -140.9877" });
    expect(stopToPlace(stop)).toEqual({ ...ocean, name: stop.name });
    expect(sameStop(stop, stopFromPoint({ ...ocean, lat: 1 }, null))).toBe(false);
  });

  it("shares identical points but never merges distinct clicks at the same hub", () => {
    const stop = stopFromPoint(point, airport);
    expect(sameStop(stop, stopFromPoint({ ...point }, airport))).toBe(true);
    expect(sameStop(stop, stopFromPoint({ ...point, lat: point.lat + 0.000001 }, airport))).toBe(false);
    expect(sameStop(stop, stopFromPoint({ ...point, lng: point.lng + 0.000001 }, airport))).toBe(false);
  });

  it("accepts old stored stops without treating their hub field as airport identity", () => {
    expect(stopToPlace({ ...point, hub: "HKG", name: "Hong Kong" }))
      .toEqual({ ...point, name: "Hong Kong" });
  });
});
