import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { ask, DATE, day, leg, record, report, tools, unsourcedMoney } from "./harness";

// Scripted conversations with home-globe Pip, against the real model and real search. Each checks what Pip did (which
// tools, with what), that every amount of money it quoted came from a tool, and how long it took. The report goes to
// docs/pip-smartness/eval-results.md.

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
