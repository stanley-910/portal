import { describe, expect, it } from "vitest";

import { toTripSummaries } from "./server";

const room = (id: string, metadata: Record<string, string | string[]>, createdAt = "2026-10-01T00:00:00.000Z", lastConnectionAt?: string) => ({
  id,
  metadata,
  createdAt: new Date(createdAt),
  ...(lastConnectionAt ? { lastConnectionAt: new Date(lastConnectionAt) } : {}),
});

describe("toTripSummaries", () => {
  it("strips the room prefix, maps fields and sorts newest first", () => {
    const out = toTripSummaries([
      room("trip:aaaaaaaaaaaaaaaa", { title: "Old", members: ["u1"], updatedAt: "2026-10-02T00:00:00.000Z" }),
      room("trip:bbbbbbbbbbbbbbbb", { title: "New", members: ["u1", "u2"], updatedAt: "2026-10-03T00:00:00.000Z" }),
    ]);
    expect(out.map((t) => t.id)).toEqual(["bbbbbbbbbbbbbbbb", "aaaaaaaaaaaaaaaa"]);
    expect(out[0]).toEqual({ id: "bbbbbbbbbbbbbbbb", title: "New", members: 2, updatedAt: "2026-10-03T00:00:00.000Z" });
  });

  it("falls back to 'New trip' when the title is missing", () => {
    expect(toTripSummaries([room("trip:cccccccccccccccc", { members: ["u1"] })])[0].title).toBe("New trip");
  });

  it("counts members given as a string or an array", () => {
    const out = toTripSummaries([
      room("trip:a", { members: "u1" }, "2026-10-01T00:00:00.000Z"),
      room("trip:b", { members: ["u1", "u2", "u3"] }, "2026-10-02T00:00:00.000Z"),
    ]);
    expect(out.find((t) => t.id === "a")?.members).toBe(1);
    expect(out.find((t) => t.id === "b")?.members).toBe(3);
  });

  it("uses updatedAt, then lastConnectionAt, then createdAt", () => {
    const [a, b, c] = toTripSummaries([
      room("trip:a", { updatedAt: "2026-10-05T00:00:00.000Z" }, "2026-10-01T00:00:00.000Z", "2026-10-04T00:00:00.000Z"),
      room("trip:b", {}, "2026-10-01T00:00:00.000Z", "2026-10-04T00:00:00.000Z"),
      room("trip:c", {}, "2026-10-01T00:00:00.000Z"),
    ]);
    expect([a.updatedAt, b.updatedAt, c.updatedAt]).toEqual([
      "2026-10-05T00:00:00.000Z",
      "2026-10-04T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    ]);
  });
});
