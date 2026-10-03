import { describe, expect, it } from "vitest";

import type { Hub } from "@/lib/transport/hubs/types";

import { placeName } from "./place-name";

const hub = (city: string) => ({ city } as Hub);

describe("placeName", () => {
  it("names the nearest printed city, not the hub", () => {
    expect(placeName({ lat: 22.308, lng: 113.918 }, hub("Hong Kong (Chek Lap Kok)"))).toBe("Hong Kong");
    expect(placeName({ lat: 26.42, lng: 111.61 }, hub("Lingling"))).toBe("Yongzhou");
  });

  it("falls back to the hub's city, without its district, far from any printed city", () => {
    expect(placeName({ lat: 30, lng: 150 }, hub("Shanghai (Pudong)"))).toBe("Shanghai");
    expect(placeName({ lat: 30, lng: 150 }, null)).toBeNull();
  });
});
