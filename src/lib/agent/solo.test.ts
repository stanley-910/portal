import { afterEach, describe, expect, it, vi } from "vitest";

import { runSolo, soloEnding, type SoloEvent, type SoloLeg } from "@/lib/agent/solo";

// Without a model key, Pip on the home globe answers from its tools: these runs never reach a provider.
afterEach(() => vi.unstubAllEnvs());

async function run(text: string, trip: SoloLeg[] = [], nationalities: string[] = []) {
  vi.stubEnv("DEEPSEEK_API_KEY", "");
  const events: SoloEvent[] = [];
  await runSolo({ messages: [{ role: "user", text }], trip, name: "Ana", nationalities }, (e) => events.push(e), new AbortController().signal);
  return events;
}

const said = (events: SoloEvent[]) => events.filter((e) => e.t === "text").map((e) => (e as { d: string }).d).join("");

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

describe("visa questions on the home globe", () => {
  const trip: SoloLeg[] = [
    {
      from: { name: "Hong Kong", lat: 22.3036, lng: 114.165, hub: "train:HK-WEST-KOWLOON", code: "HK-WEST-KOWLOON" },
      to: { name: "Shanghai", lat: 31.1945, lng: 121.3201, hub: "train:SHANGHAI-HONGQIAO", code: "SHANGHAI-HONGQIAO" },
      date: "2026-10-09",
    },
  ];

  it("answers for every saved passport, by name, without the model", async () => {
    const text = said(await run("Do I need a visa?", trip, ["USA", "CAN"]));
    expect(text).toMatch(/United States passport: needs a visa/);
    expect(text).toMatch(/Canada passport: visa-free for up to 30 days/);
    expect(text).toMatch(/Easiest: the Canada passport/);
    expect(text).toMatch(/official government sources/);
  });

  it("asks for a passport when none is saved", async () => {
    expect(said(await run("Do I need a visa?", trip))).toMatch(/Passports in the profile menu/);
  });
});

describe("soloEnding", () => {
  const did = (over: Partial<Parameters<typeof soloEnding>[1]> = {}) => ({ planned: false, aborted: false, finish: "stop", ...over });

  it("adds nothing to a reply that finished", () => {
    expect(soloEnding("Here you go.", did())).toBe("");
  });

  it("never leaves a reply blank, and only says it's on the globe when it is", () => {
    expect(soloEnding("", did({ planned: true }))).toBe("It's on your globe.");
    expect(soloEnding("", did())).not.toMatch(/Done|globe/);
    expect(soloEnding("", did({ finish: "length" }))).toMatch(/didn't get to the end/);
    expect(soloEnding("", did({ aborted: true }))).toMatch(/ran out of time/);
  });

  it("owns up to a reply cut off partway", () => {
    expect(soloEnding("The cheapest is", did({ finish: "length" }))).toMatch(/cut off/);
    expect(soloEnding("The cheapest is", did({ aborted: true }))).toMatch(/ran out of time/);
  });
});

describe("planning latency and cancellation", () => {
  it("publishes a multi-leg plan without waiting for globe animation", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("DEEPSEEK_API_KEY", "");
      const events: SoloEvent[] = [];
      await runSolo({ messages: [{ role: "user", text: "Hong Kong to Shanghai to Tokyo on 2026-11-15" }], trip: [], name: "Ana", nationalities: [] }, (event) => events.push(event), new AbortController().signal);
      expect(events.find((e) => e.t === "trip")).toMatchObject({ legs: expect.any(Array) });
      expect(events.at(-1)).toEqual({ t: "done" });
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("a cancelled fallback cannot restore a trip or emit a late failure", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    const abort = new AbortController(); abort.abort();
    const events: SoloEvent[] = [];
    await runSolo({ messages: [{ role: "user", text: "Hong Kong to Tokyo" }], trip: [], name: "Ana", nationalities: [] }, (event) => events.push(event), abort.signal);
    expect(events).toEqual([]);
  });
});
