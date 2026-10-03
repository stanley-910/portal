import { describe, expect, it } from "vitest";

import { inOrder } from "@/lib/agent/parts";
import type { ThreadCard } from "@/lib/agent/types";

const step = (label: string, at?: number): ThreadCard => ({ type: "status", label, done: true, at });

describe("inOrder", () => {
  it("puts each card where the text had got to", () => {
    const parts = inOrder("Let me look.\n\nShanghai is cheapest.", [step("Read the trip", 12), step("Compared 9 routes", 12)]);
    expect(parts.map((p) => (p.kind === "text" ? p.text : p.card.type === "status" && p.card.label))).toEqual([
      "Let me look.",
      "Read the trip",
      "Compared 9 routes",
      "Shanghai is cheapest.",
    ]);
  });

  it("puts cards without a place after the text", () => {
    const parts = inOrder("Done.", [step("Old card")]);
    expect(parts.map((p) => p.kind)).toEqual(["text", "card"]);
  });

  it("holds a card at the end while the streamed text hasn't reached it", () => {
    const parts = inOrder("Let", [step("Read the trip", 12)]);
    expect(parts.map((p) => p.kind)).toEqual(["text", "card"]);
  });
});
