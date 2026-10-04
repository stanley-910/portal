import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { planGroup } from "@/lib/agent/group";
import { describeRoute, optimize } from "@/lib/agent/optimize";
import { stopToPlace } from "@/lib/trip/stops";
import { DATE, stop } from "./harness";

// The group planner against real search: friends from different cities meeting in one, as in the demo. Results go to
// docs/pip-smartness/group-results.md. `pnpm eval:pip evals/group.eval.ts`

const CASES = [
  { name: "Demo: two from Hong Kong and one from Seoul meet in Shanghai", to: "Shanghai", currency: "USD",
    travellers: [["ann", "Ann", "Hong Kong"], ["bo", "Bo", "Hong Kong"], ["cy", "Cy", "Seoul"]] },
  { name: "Taipei and Busan meet in Tokyo", to: "Tokyo", currency: "USD", travellers: [["ann", "Ann", "Taipei"], ["bo", "Bo", "Busan"]] },
  { name: "Singapore and Bangkok meet in Kuala Lumpur", to: "Kuala Lumpur", currency: "USD", travellers: [["ann", "Ann", "Singapore"], ["bo", "Bo", "Bangkok"]] },
] as const;

const out: string[] = [`# Group plan results\n\nRun ${new Date().toISOString()}, date ${DATE}. Regenerate with \`pnpm eval:pip evals/group.eval.ts\`.\n`];

describe("group planner", () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const started = Date.now();
      const plan = await planGroup({
        travellers: c.travellers.map(([id, name, from]) => ({ id, name, from: stopToPlace(stop(from)) })),
        to: stopToPlace(stop(c.to)), date: DATE, currency: c.currency,
      }, (q) => optimize(q, AbortSignal.timeout(25_000)));
      out.push(`## ${c.name}\n`,
        `- ${((Date.now() - started) / 1000).toFixed(1)} s; total ${plan.total ? `${plan.total.converted ? "about " : ""}${plan.total.currency} ${plan.total.amount}` : "unknown"}; arrivals ${plan.spreadMin} min apart`,
        ...plan.picks.map((p) => `- ${p.member.name}: ${describeRoute(p.route)}`),
        ...plan.missing.map((m) => `- ${m.member.name}: none (${m.reason})`), "");
      expect(plan.picks.length + plan.missing.length).toBe(c.travellers.length);
    }, 120_000);
  }
});

afterAll(() => {
  mkdirSync("docs/pip-smartness", { recursive: true });
  writeFileSync("docs/pip-smartness/group-results.md", out.join("\n"));
});
