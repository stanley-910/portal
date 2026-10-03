import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { resolvePlace } from "@/lib/agent/edit";
import { describeRoutes, optimize } from "@/lib/agent/optimize";
import { stopToPlace } from "@/lib/trip/stops";
import { ask, record, report as pipReport, tools, unsourcedMoney } from "./harness";

// Does "find me something cheaper" carry beyond Hong Kong → Shanghai? Two layers per corridor: the route optimizer on
// its own against real search (what it finds), then Pip asked in plain words (what it does with it). Results go to
// docs/pip-smartness/corridor-results.md.

const DATE = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

const CORRIDORS: { name: string; from: string; to: string; currency: string; ask: string }[] = [
  { name: "Hong Kong → Shanghai", from: "Hong Kong", to: "Shanghai", currency: "CNY", ask: `Hong Kong to Shanghai on ${DATE} is too pricey. Any cheaper way?` },
  { name: "Seoul → Busan", from: "Seoul", to: "Busan", currency: "KRW", ask: `I need to get from Seoul to Busan on ${DATE} as cheaply as possible.` },
  { name: "Singapore → Kuala Lumpur", from: "Singapore", to: "Kuala Lumpur", currency: "SGD", ask: `What's the cheapest way from Singapore to Kuala Lumpur on ${DATE}? Flights look expensive.` },
  { name: "Taipei → Kaohsiung", from: "Taipei", to: "Kaohsiung", currency: "TWD", ask: `Taipei to Kaohsiung on ${DATE}, I'm on a budget. What's cheapest?` },
  { name: "Bangkok → Chiang Mai", from: "Bangkok", to: "Chiang Mai", currency: "THB", ask: `Bangkok to Chiang Mai on ${DATE} — can I do it for less than flying from Suvarnabhumi?` },
  { name: "Hong Kong → Tokyo", from: "Hong Kong", to: "Tokyo", currency: "HKD", ask: `Flights from Hong Kong to Tokyo on ${DATE} are expensive. Would flying from Shenzhen or Macau be cheaper?` },
];

const place = (name: string) => {
  const r = resolvePlace(name);
  if ("refusal" in r) throw new Error(`can't resolve ${name}`);
  return stopToPlace(r.stop);
};

const optimizer: string[] = [];
const live = !!process.env.DEEPSEEK_API_KEY;

describe("route optimizer across corridors", () => {
  for (const c of CORRIDORS) {
    it(c.name, async () => {
      const started = Date.now();
      const composed = await optimize({ from: place(c.from), to: place(c.to), date: DATE, currency: c.currency }, AbortSignal.timeout(30_000));
      const ms = Date.now() - started;
      const out = describeRoutes(composed);
      const cheaper = composed.routes.filter((r) => (r.saves ?? 0) > 0);
      const unpriced = composed.routes.filter((r) => !r.total).length;
      optimizer.push([
        `### ${c.name}`,
        `- ${(ms / 1000).toFixed(1)} s, ${composed.searched} searches; gateways: ${composed.gateways.map((g) => g.name).join(", ") || "none"}`,
        `- ${composed.routes.length} alternatives, ${cheaper.length} cheaper than direct, ${unpriced} without a total`,
        `- baseline: ${out.baseline ?? "none priced"}`,
        ...out.routes.map((r) => `- ${r}`),
        "",
      ].join("\n"));
      // every chained route leaves after the one before it arrives
      for (const r of composed.routes) {
        for (let i = 1; i < r.parts.length; i++) expect(Date.parse(r.parts[i].depart)).toBeGreaterThan(Date.parse(r.parts[i - 1].arrive));
      }
      expect(composed.baseline || composed.routes.length).toBeTruthy();
    }, 60_000);
  }
});

describe.runIf(live)("Pip across corridors", () => {
  for (const c of CORRIDORS) {
    it(c.name, async () => {
      const run = await ask(c.ask);
      record(c.name, run);
      expect(run.failed).toBe(false);
      expect(tools(run)).toContain("optimize_route");
      expect(unsourcedMoney(run)).toEqual([]);
    });
  }
});

afterAll(() => {
  mkdirSync("docs/pip-smartness", { recursive: true });
  writeFileSync("docs/pip-smartness/corridor-results.md", [
    "# Corridor results",
    "",
    `Run ${new Date().toISOString()}, trip date ${DATE}. Regenerate with \`pnpm eval:pip evals/corridors.eval.ts\`.`,
    "",
    "## Route optimizer",
    "",
    ...optimizer,
    "## Pip",
    "",
    ...pipReport,
  ].join("\n"));
});
