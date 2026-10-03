import { afterEach, describe, expect, it, vi } from "vitest";

import { runSolo, type SoloEvent } from "@/lib/agent/solo";

// Without a model key, Pip on the home globe answers from its tools: these runs never reach a provider.
afterEach(() => vi.unstubAllEnvs());

async function run(text: string) {
  vi.stubEnv("DEEPSEEK_API_KEY", "");
  const events: SoloEvent[] = [];
  await runSolo({ messages: [{ role: "user", text }], trip: [], name: "Ana" }, (e) => events.push(e), new AbortController().signal);
  return events;
}

describe("runSolo without a model", () => {
  it("puts the cities named in a message on the globe, on the date given", async () => {
    const events = await run("Train from Hong Kong to Shanghai on 2026-10-09");
    const trip = events.find((e) => e.t === "trip");
    expect(trip).toMatchObject({ t: "trip", legs: [{ from: { name: "Hong Kong" }, to: { name: "Shanghai" }, date: "2026-10-09" }] });
    expect(events.at(-1)).toEqual({ t: "done" });
    expect(events.filter((e) => e.t === "text").map((e) => (e as { d: string }).d).join("")).toMatch(/Hong Kong → Shanghai is on your globe/);
  });

  it("asks where they're going when the message names no route", async () => {
    const events = await run("hello");
    expect(events.some((e) => e.t === "trip")).toBe(false);
    expect(events.at(-1)).toEqual({ t: "done" });
  });
});
