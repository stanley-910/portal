import { describe, expect, it } from "vitest";

import { planTitle } from "./title";

const stop = (name: string) => ({ lat: 0, lng: 0, hub: null, name });
const leg = (from: string, to: string, date: string, createdAt: number) => ({ from, to, date, createdAt });

describe("planTitle", () => {
  it("names the demo route: starts first, then travel order", () => {
    const json = {
      stops: { a: stop("Hong Kong"), b: stop("Shanghai"), c: stop("Seoul"), d: stop("Tokyo") },
      legs: {
        l3: leg("b", "d", "2026-11-03", 3),
        l2: leg("c", "b", "2026-11-02", 2),
        l1: leg("a", "b", "2026-11-02", 1),
      },
    };
    expect(planTitle(json)).toBe("Hong Kong → Seoul → Shanghai → Tokyo");
  });

  it("lists each name once, even for a round trip", () => {
    const json = {
      stops: { a: stop("Hong Kong"), b: stop("Tokyo") },
      legs: { l1: leg("a", "b", "2026-11-01", 1), l2: leg("b", "a", "2026-11-05", 2) },
    };
    expect(planTitle(json)).toBe("Hong Kong → Tokyo");
  });

  it("is 'New trip' when empty or garbage", () => {
    expect(planTitle({})).toBe("New trip");
    expect(planTitle(null)).toBe("New trip");
    expect(planTitle("x")).toBe("New trip");
    expect(planTitle({ stops: 3, legs: [1, { from: 1 }] })).toBe("New trip");
    expect(planTitle({ legs: { l: leg("a", "b", "2026-11-01", 1) } })).toBe("New trip");
  });

  it("truncates to 120 characters with an ellipsis", () => {
    const stops: Record<string, unknown> = {};
    const legs: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) {
      stops[`s${i}`] = stop(`Place number ${i}`);
      if (i) legs[`l${i}`] = leg(`s${i - 1}`, `s${i}`, "2026-11-01", i);
    }
    const title = planTitle({ stops, legs });
    expect(title).toHaveLength(120);
    expect(title.endsWith("…")).toBe(true);
  });
});
