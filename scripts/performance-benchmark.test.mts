// Explicit microbenchmarks; omitted from normal tests. PERF_OUTPUT selects the result file.
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { HUBS, HUB_LIMITS } from "../src/lib/transport/hubs/catalog";
import { distanceKm } from "../src/lib/transport/hubs/geo";
import { nearestPreviewHub } from "../src/lib/transport/hubs/preview";
import { selectPlanLegs, type PlanSnapshot } from "../src/lib/trip/projections";

const exhaustive = (point: { lat: number; lng: number }) => {
  let nearest: typeof HUBS[number] | null = null, bestDistance = Infinity;
  for (const hub of HUBS) {
    const distance = distanceKm(point, hub);
    if (distance > HUB_LIMITS.radiusKm[hub.mode]) continue;
    if (distance < bestDistance || (distance === bestDistance && nearest && hub.id < nearest.id)) { nearest = hub; bestDistance = distance; }
  }
  return nearest;
};
// Original usePlanLegs selector + equality at audit baseline, retained only for benchmarking.
const originalLegs = (root: PlanSnapshot) => Object.entries(root.legs).flatMap(([id, leg]) => {
  const from = root.stops[leg.from], to = root.stops[leg.to];
  if (!from || !to) return [];
  const votes: Record<string, string[]> = {};
  for (const [who, offer] of Object.entries(leg.votes)) (votes[offer] ??= []).push(who);
  return [{ id, from: { id: leg.from, ...from }, to: { id: leg.to, ...to }, date: leg.date, createdBy: leg.createdBy, riders: leg.riders, search: leg.search, votes, chosen: leg.search.offers.find((o) => o.id === leg.chosen) ?? null, createdAt: leg.createdAt, booking: leg.booking ?? null, bookingNotice: leg.bookingNotice ?? null }];
}).sort((a, b) => a.createdAt - b.createdAt);
const measure = (run: () => void) => {
  run();
  const values = Array.from({ length: 7 }, () => { const start = performance.now(); run(); return performance.now() - start; });
  return { medianMs: [...values].sort((a, b) => a - b)[3], samplesMs: values };
};
it.skipIf(!process.env.PERF_OUTPUT)("compares exact hover and unchanged plan subscriber workloads", () => {
  const points = HUBS.filter((_, i) => i % 4 === 0).map((h) => ({ lat: Math.min(90, h.lat + 0.2), lng: h.lng }));
  expect(points.map((p) => nearestPreviewHub(p)?.id)).toEqual(points.map((p) => exhaustive(p)?.id));
  const root: PlanSnapshot = {
    members: { a: { name: "A", color: 1 } },
    stops: { a: { lat: 0, lng: 0, hub: null, name: "A" }, b: { lat: 1, lng: 1, hub: null, name: "B" } },
    legs: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`leg${i}`, { from: "a", to: "b", date: "2026-10-05", createdBy: "a", riders: ["a"], search: { id: `s${i}`, status: "done" as const, offers: [] }, votes: { a: "x" }, chosen: null, createdAt: i }])),
  };
  const oldValue = originalLegs(root), newValue = selectPlanLegs(root);
  expect(newValue).toEqual(oldValue);
  let sink = 0;
  const results = {
    context: "Node process, 7 timed rounds after warmup. Identical catalogue/outputs. Plan workload is 1000 unrelated root updates x 8 subscribers on a 20-leg immutable snapshot. Not end-to-end UI latency.",
    hover: { queries: points.length, before: measure(() => { for (const p of points) sink += Number(!!exhaustive(p)); }), after: measure(() => { for (const p of points) sink += Number(!!nearestPreviewHub(p)); }) },
    plan: {
      before: measure(() => { for (let i = 0; i < 8000; i++) sink += Number(JSON.stringify(originalLegs({ ...root })) === JSON.stringify(oldValue)); }),
      after: measure(() => { for (let i = 0; i < 8000; i++) sink += Number(selectPlanLegs({ ...root }) === newValue); }),
    },
  };
  expect(sink).toBeGreaterThan(0);
  writeFileSync(process.env.PERF_OUTPUT!, JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
}, 30_000);
