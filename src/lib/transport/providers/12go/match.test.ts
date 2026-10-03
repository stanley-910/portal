import { describe, expect, it } from "vitest";
import type { Place } from "../../types";
import { matchesRoute } from "./match";
import type { SeedRoute, SeedStop } from "./index";

const stop = (slug: string, lat: number, lng: number): SeedStop => ({ name: slug, slug, lat, lng, country: "TH" });
const place = (lat: number, lng: number): Place => ({ name: "p", lat, lng });
const route = (from: SeedStop, to: SeedStop): SeedRoute => ({
  from, to, operators: ["x"], departures: ["09:00"], tz: "Asia/Bangkok", durationMin: 60, source: "test",
});

describe("12go matchesRoute", () => {
  it("matches forward and reverse within the radius", () => {
    const r = route(stop("a", 9.0, 99.0), stop("b", 9.0, 100.0));
    expect(matchesRoute(place(9.0, 99.0), place(9.0, 100.0), r)).toBe("forward");
    expect(matchesRoute(place(9.0, 100.0), place(9.0, 99.0), r)).toBe("reverse");
    expect(matchesRoute(place(20, 99), place(9.0, 100.0), r)).toBeNull();
  });

  it("picks the closer assignment when both directions fit", () => {
    // Stops ~44 km apart, so the 30 km floor admits both directions for a ~44 km trip.
    const r = route(stop("a", 9.0, 99.0), stop("b", 9.0, 99.4));
    const from = place(9.0, 99.35); // next to b
    const to = place(9.0, 99.05); // next to a
    expect(matchesRoute(from, to, r)).toBe("reverse");
    // Mirror image: forward is closer.
    expect(matchesRoute(to, from, r)).toBe("forward");
  });
});
