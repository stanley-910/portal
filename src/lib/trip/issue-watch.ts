"use client";

import { useOthers, useSelf, useStorage } from "@liveblocks/react";
import { useEffect } from "react";

import { notePlanIssues } from "@/app/t/actions";
import { planIssues } from "@/lib/agent/issues";
import type { PlanJson } from "@/lib/agent/snapshot";

/** How long the plan has to sit still before Pip speaks up: a route being drawn or picks being changed settle first. */
const SETTLE_MS = 4_000;

/**
 * Has Pip say something when the plan goes wrong (lib/agent/issues.ts): two friends on different flights for the
 * same trip, arrivals hours apart, someone leaving with no way home. One member's client asks, the one with the
 * lowest connection; the server checks the plan itself and says each problem once.
 */
export function usePlanIssueWatch(tripId: string) {
  const unsaid = useStorage((root) => {
    const plan = root as unknown as PlanJson;
    const said = new Set((plan.thread ?? []).flatMap((m) => m.cards.flatMap((c) => (c.type === "fix" ? [c.key] : []))));
    return planIssues(plan).filter((i) => !said.has(i.key)).map((i) => i.key).join("\n");
  });
  const me = useSelf((s) => s.connectionId);
  const lowest = useOthers((others) => Math.min(Infinity, ...others.map((o) => o.connectionId)));
  const mine = me !== null && me !== undefined && me < lowest;
  useEffect(() => {
    if (!unsaid || !mine) return;
    const timer = window.setTimeout(() => void notePlanIssues(tripId).catch(() => {}), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [unsaid, mine, tripId]);
}
