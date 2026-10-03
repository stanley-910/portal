import { describe, expect, it } from "vitest";

import { tripContext, type PlanView } from "@/lib/agent/context";

const stops = { hk: { name: "Hong Kong" }, sh: { name: "Shanghai" }, sel: { name: "Seoul" }, tyo: { name: "Tokyo" } };
const leg = (from: string, to: string, date: string, riders: string[], extra: Partial<{ chosen: string; offers: unknown[] }> = {}) => ({
  from, to, date, riders, chosen: extra.chosen ?? null, createdAt: 0, search: { status: "done", offers: extra.offers ?? [] },
});

describe("tripContext", () => {
  it("suggests planning a first leg in an empty solo trip", () => {
    const ctx = tripContext({ members: { a: { name: "Ana" } } }, "a");
    expect(ctx.line).toBe("No legs yet");
    expect(ctx.chips[0]).toMatch(/^Train from/);
  });

  it("suggests meeting up in an empty group trip", () => {
    const ctx = tripContext({ members: { a: { name: "Ana" }, b: { name: "Joon" } } }, "a");
    expect(ctx.line).toBe("No legs yet · 2 people");
    expect(ctx.chips[0]).toBe("Where should we meet?");
  });

  it("names the route and asks about whoever has no way there yet", () => {
    const plan: PlanView = {
      members: { a: { name: "Ana" }, b: { name: "Joon" } },
      stops,
      legs: { l1: leg("hk", "sh", "2026-10-09", ["a"]), l2: leg("sh", "tyo", "2026-10-12", ["a"]) },
    };
    const ctx = tripContext(plan, "a");
    expect(ctx.line).toBe("Hong Kong → Shanghai → Tokyo · Fri 9 Oct · 2 people");
    expect(ctx.chips).toEqual(["How does Joon get to Shanghai?", "How do we get back to Hong Kong?", "Who pays what?"]);
  });

  it("asks about the one leg with options nobody has picked", () => {
    const plan: PlanView = { members: { a: { name: "Ana" } }, stops, legs: { l1: leg("hk", "sh", "2026-10-09", ["a"], { offers: [{}] }) } };
    expect(tripContext(plan, "a").chips.slice(0, 2)).toEqual(["What's best from Hong Kong to Shanghai?", "How do I get back to Hong Kong?"]);
  });

  it("shortens a long route", () => {
    const plan: PlanView = {
      members: { a: { name: "Ana" } },
      stops,
      legs: { l1: leg("hk", "sh", "2026-10-09", ["a"]), l2: leg("sh", "sel", "2026-10-10", ["a"]), l3: leg("sel", "tyo", "2026-10-11", ["a"]) },
    };
    expect(tripContext(plan, "a").line).toBe("Hong Kong → … → Tokyo · Fri 9 Oct");
  });
});
