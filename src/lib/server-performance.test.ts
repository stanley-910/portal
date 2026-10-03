import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { fanOut } from "./transport/search";
import { runSolo } from "./agent/solo";
import { queuePollMs } from "./agent/queue-wakeup";
import type { Offer, SearchQuery, TransportProvider } from "./transport/types";

// Controlled offline workload: no credentials or external calls. Baseline is the old scheduling contract,
// reproduced against the same synthetic waits, rather than a claim about production provider latency.
const report: Record<string, unknown> = { baseline: "22abdf9", workload: "offline scheduling fixtures; milliseconds use a virtual clock" };
const q: SearchQuery = { from: { name: "A", lat: 22, lng: 114 }, to: { name: "B", lat: 31, lng: 121 }, date: "2026-11-15", modes: ["flight"], passengers: 1, currency: "USD" };
const offer = (id: string, provider: Offer["provider"]): Offer => ({ id, provider, mode: "flight", kind: "estimated", segments: [{ from: q.from, to: q.to, depart: "2026-11-15T00:00:00Z", arrive: "2026-11-15T02:00:00Z", durationMin: 120, mode: "flight" }] });
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("server scheduling performance fixtures", () => {
  it("measures first useful fares and concurrent provider work", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    let calls = 0, peak = 0, active = 0, first: number | undefined;
    const fast: TransportProvider = { id: "travelpayouts", modes: ["flight"], covers: () => true, search: async () => [offer("local", "travelpayouts")] };
    const slow: TransportProvider = { id: "duffel", modes: ["flight"], covers: () => true, search: async () => {
      calls++; peak = Math.max(peak, ++active); await sleep(1000); active--; return [offer("remote", "duffel")];
    } };
    const work = Promise.all(Array.from({ length: 20 }, (_, i) => fanOut({ ...q, passengers: 1 + i % 5 }, { providers: [fast, slow], onProgress: (result) => {
      if (result.offers.length && first === undefined) first = Date.now() - start;
    } })));
    await vi.advanceTimersByTimeAsync(1000);
    await work;
    // The old allSettled response barrier withheld the immediate local offer until the 1000 ms slow result.
    report.transport = { queries: 20, distinctQueries: 5, before: { firstUsefulMs: 1000, providerCalls: 20, peakProviderCalls: 20 }, after: { firstUsefulMs: first, providerCalls: calls, peakProviderCalls: peak, completeMs: Date.now() - start } };
    expect(first).toBe(0); expect(calls).toBe(5); expect(peak).toBe(5);
  });

  it("measures Pip planning without server animation waits", async () => {
    vi.useFakeTimers(); vi.stubEnv("DEEPSEEK_API_KEY", "");
    const start = Date.now();
    let legs = 0;
    await runSolo({ messages: [{ role: "user", text: "Hong Kong to Shanghai to Tokyo on 2026-11-15" }], trip: [], name: "Fixture", nationalities: [] }, (e) => { if (e.t === "trip") legs = e.legs.length; }, new AbortController().signal);
    report.pip = { legs, before: { animationWaitMs: 1300 + 2 * 1200 + 500 + 700 }, after: { animationWaitMs: Date.now() - start } };
    expect(legs).toBe(2); expect(Date.now() - start).toBe(0);
  });

  it("measures queue polling over one 60 second wait", () => {
    const count = (delay: (i: number) => number) => { let reads = 0, at = 0; while (at < 60000) { at += delay(reads); reads++; } return reads; };
    report.queue = { windowMs: 60000, before: { polls: count(() => 1500) }, after: { polls: count(queuePollMs), localCompletionWakeMs: 0 } };
    expect(count(queuePollMs)).toBe(14);
    const destination = process.env.PORTAL_SERVER_BENCH_REPORT;
    if (destination) writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
  });
});
