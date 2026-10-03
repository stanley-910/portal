import { mkdirSync, writeFileSync } from "node:fs";
import type { TextStreamPart, ToolSet } from "ai";
import { afterAll, describe, expect, it } from "vitest";
import { resolvePlace } from "@/lib/agent/edit";
import { runSolo, type SoloEvent, type SoloLeg } from "@/lib/agent/solo";

// Scripted conversations with home-globe Pip, against the real model and real search. Each checks what Pip did (which
// tools, with what), that every amount of money it quoted came from a tool, and how long it took. The report goes to
// docs/pip-smartness/eval-results.md.

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const DATE = day(14);
const stop = (name: string) => {
  const r = resolvePlace(name);
  if ("refusal" in r) throw new Error(`can't resolve ${name}`);
  return r.stop;
};
const leg = (from: string, to: string, date = DATE): SoloLeg => ({ from: stop(from), to: stop(to), date });

type Call = { tool: string; input: unknown; output: unknown };
type Run = {
  asked: string; text: string; calls: Call[]; ms: number; firstTextMs: number | null; steps: number;
  reasoning: number[]; legs: SoloLeg[] | null; failed: boolean;
};

async function ask(text: string, trip: SoloLeg[] = []): Promise<Run> {
  const started = Date.now();
  const run: Run = { asked: text, text: "", calls: [], ms: 0, firstTextMs: null, steps: 0, reasoning: [], legs: null, failed: false };
  const pending = new Map<string, Call>();
  const emit = (e: SoloEvent) => {
    if (e.t === "text") {
      run.text += e.d;
      if (run.firstTextMs === null && e.d.trim()) run.firstTextMs = Date.now() - started;
    } else if (e.t === "trip") run.legs = e.legs;
    else if (e.t === "failed") run.failed = true;
  };
  const observe = (part: TextStreamPart<ToolSet>) => {
    if (part.type === "tool-call") {
      const call = { tool: part.toolName, input: part.input, output: undefined };
      pending.set(part.toolCallId, call);
      run.calls.push(call);
    } else if (part.type === "tool-result") {
      const call = pending.get(part.toolCallId);
      if (call) call.output = part.output;
    } else if (part.type === "finish-step") {
      run.steps++;
      run.reasoning.push(part.usage.outputTokenDetails?.reasoningTokens ?? 0);
    }
  };
  await runSolo({ messages: [{ role: "user", text }], trip, name: "Sam", nationalities: ["GBR"] }, emit,
    AbortSignal.timeout(120_000), observe);
  run.ms = Date.now() - started;
  return run;
}

const CURRENCY: Record<string, string> = {
  "¥": "CNY", rmb: "CNY", yuan: "CNY", cny: "CNY", "hk$": "HKD", hkd: "HKD", "$": "USD", "us$": "USD", usd: "USD",
  krw: "KRW", "₩": "KRW", jpy: "JPY",
};
const SYMBOL = String.raw`(¥|HK\$|US\$|\$|₩|CNY|HKD|USD|KRW|JPY|RMB)`;
const AMOUNT = String.raw`(\d[\d,]*(?:\.\d+)?)`;

/** "CNY 878.5"-style pairs: currency before or after the amount, or a {amount, currency} object. */
function moneyIn(text: string): string[] {
  const out: string[] = [];
  const add = (cur: string, n: string) => out.push(`${CURRENCY[cur.toLowerCase()] ?? cur.toUpperCase()} ${Number(n.replace(/,/g, ""))}`);
  for (const m of text.matchAll(new RegExp(`${SYMBOL}\\s?${AMOUNT}`, "gi"))) add(m[1], m[2]);
  for (const m of text.matchAll(new RegExp(`${AMOUNT}\\s?(yuan|CNY|HKD|USD|RMB|KRW)\\b`, "gi"))) add(m[2], m[1]);
  for (const m of text.matchAll(/"amount":\s*([\d.]+),\s*"currency":\s*"([A-Z]{3})"/g)) add(m[2], m[1]);
  return out;
}

/**
 * Money in the reply that neither a tool's result nor the person gave, compared as currency and amount together
 * (rounded either way): the model working out a fare itself.
 */
function unsourcedMoney(run: Run): string[] {
  const given = new Set<string>();
  for (const pair of [...moneyIn(run.asked), ...run.calls.flatMap((c) => moneyIn(JSON.stringify(c.output ?? "")))]) {
    const [cur, n] = pair.split(" ");
    given.add(`${cur} ${Number(n)}`).add(`${cur} ${Math.round(Number(n))}`);
  }
  return moneyIn(run.text).filter((pair) => !given.has(pair));
}

const tools = (run: Run) => run.calls.map((c) => c.tool);
const report: string[] = [];
function record(name: string, run: Run, notes: string[] = []) {
  report.push([
    `### ${name}`,
    `- ${(run.ms / 1000).toFixed(1)} s total, first words at ${run.firstTextMs === null ? "—" : `${(run.firstTextMs / 1000).toFixed(1)} s`}, ${run.steps} model steps, reasoning tokens per step ${run.reasoning.join(" / ") || "—"}`,
    `- tools: ${tools(run).join(" → ") || "none"}`,
    ...run.calls.map((c) => `  - ${c.tool} ${JSON.stringify(c.input)}`),
    ...run.calls.filter((c) => c.tool.startsWith("optimize")).map((c) => {
      const o = c.output as { baseline?: string | null; routes?: string[] } | undefined;
      return `  - optimizer said: ${[o?.baseline, ...(o?.routes ?? [])].filter(Boolean).join(" | ")}`;
    }),
    ...notes.map((n) => `- ${n}`),
    `- unsourced money: ${unsourcedMoney(run).join(", ") || "none"}`,
    "",
    "> " + run.text.trim().replace(/\n+/g, "\n> "),
    "",
  ].join("\n"));
}

const live = !!process.env.DEEPSEEK_API_KEY;

describe.runIf(live)("Pip on the home globe", () => {
  it("finds the Shenzhen reroute when Hong Kong → Shanghai is too expensive", async () => {
    const run = await ask(
      "The trains and flights from Hong Kong to Shanghai are too expensive for me. My friend is coming from Guangzhou and we both want to end up in Shanghai. How can I get my price down?",
      [leg("Hong Kong", "Shanghai")],
    );
    record("Hong Kong → Shanghai too expensive", run);
    expect(run.failed).toBe(false);
    expect(tools(run)).toContain("optimize_route");
    expect(run.text).toMatch(/Shenzhen/);
    expect(unsourcedMoney(run)).toEqual([]);
  });

  it("passes a stated budget through", async () => {
    const run = await ask(`Get me from Hong Kong to Shanghai on ${DATE} for under ¥950.`);
    record("Budget in yuan", run);
    const call = run.calls.find((c) => c.tool === "optimize_route");
    expect(call?.input).toMatchObject({ max_fare: 950, currency: "CNY" });
    expect(unsourcedMoney(run)).toEqual([]);
  });

  it("lines up an arrival with a friend's train", async () => {
    const run = await ask(
      `My friend's train gets into Shanghai Hongqiao at 22:40 on ${DATE}. I'm leaving from Hong Kong. What's the cheapest way to get there around the same time?`,
    );
    record("Arrive with a friend", run);
    const call = run.calls.find((c) => c.tool === "optimize_route");
    expect((call?.input as { arrive_near?: string })?.arrive_near).toMatch(new RegExp(`^${DATE}T22:40`));
    expect(run.text).toMatch(/22:4\d/);
    expect(unsourcedMoney(run)).toEqual([]);
  });

  it("moves a trip quickly without heavy thinking", async () => {
    const run = await ask(`Actually make it ${day(16)} instead.`, [leg("Hong Kong", "Shanghai")]);
    record("Simple date change", run);
    expect(tools(run)).toEqual(["plan_trip"]);
    expect(run.legs?.[0].date).toBe(day(16));
    expect(run.reasoning[0]).toBeLessThan(1_000);
  });

  it("finds a meet-up city", async () => {
    const run = await ask(`I'm in Seoul and my friend's in Hong Kong. Where should we meet on ${DATE}?`);
    record("Where to meet", run);
    expect(tools(run)).toContain("find_meetup");
    expect(unsourcedMoney(run)).toEqual([]);
  });

  it("declines sightseeing without searching", async () => {
    const run = await ask("What sights should I see in Shanghai?");
    record("Out of scope", run);
    expect(run.failed).toBe(false);
    expect(tools(run)).toEqual([]);
    expect(run.text).toMatch(/not (my|something)|outside|don't do|aren't my|isn't my/i);
    expect(run.ms).toBeLessThan(20_000);
  });

  afterAll(() => {
    mkdirSync("docs/pip-smartness", { recursive: true });
    writeFileSync("docs/pip-smartness/eval-results.md", [
      "# Pip eval results",
      "",
      `Run ${new Date().toISOString()}, model deepseek-flash, trip date ${DATE}. Regenerate with \`pnpm eval:pip\`.`,
      "",
      ...report,
    ].join("\n"));
  });
});
