import type { TextStreamPart, ToolSet } from "ai";
import { resolvePlace } from "@/lib/agent/edit";
import { runSolo, type SoloEvent, type SoloLeg } from "@/lib/agent/solo";

// Shared by the eval suites: runs one home-globe Pip reply and records what it did.

export const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
export const DATE = day(14);
export const stop = (name: string) => {
  const r = resolvePlace(name);
  if ("refusal" in r) throw new Error(`can't resolve ${name}`);
  return r.stop;
};
export const leg = (from: string, to: string, date = DATE): SoloLeg => ({ from: stop(from), to: stop(to), date });

type Call = { tool: string; input: unknown; output: unknown };
export type Run = {
  asked: string; text: string; calls: Call[]; ms: number; firstTextMs: number | null; steps: number;
  reasoning: number[]; legs: SoloLeg[] | null; failed: boolean;
};

export async function ask(text: string, trip: SoloLeg[] = []): Promise<Run> {
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
const AMOUNT = String.raw`(\d(?:[\d,]*\d)?(?:\.\d+)?)`;

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
export function unsourcedMoney(run: Run): string[] {
  const given = new Set<string>();
  for (const pair of [...moneyIn(run.asked), ...run.calls.flatMap((c) => moneyIn(JSON.stringify(c.output ?? "")))]) {
    const [cur, n] = pair.split(" ");
    given.add(`${cur} ${Number(n)}`).add(`${cur} ${Math.round(Number(n))}`);
  }
  return moneyIn(run.text).filter((pair) => !given.has(pair));
}

export const tools = (run: Run) => run.calls.map((c) => c.tool);
export const report: string[] = [];
export function record(name: string, run: Run, notes: string[] = []) {
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

