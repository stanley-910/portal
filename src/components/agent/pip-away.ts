"use client";

import { useSyncExternalStore } from "react";

// Where Pip is while its saucer works the globe. Pip drops through a portal at its own spot (the chat's header, or
// the launcher in the corner) before the saucer flies in; the portal stays open while it's out; once the saucer has
// flown off, Pip rises back out and the portal closes. The saucer (pip-saucer.tsx) moves Pip along; every sprite of
// Pip that sits in its spot (pip-sprite.tsx, `portal`) draws it.

export type AwayPhase = "home" | "leaving" | "away" | "returning";

/** How long Pip takes to drop through the portal, or rise out of it and close it. */
export const PORTAL_MS = 900;

let state: { phase: AwayPhase; since: number } = { phase: "home", since: 0 };
const listeners = new Set<() => void>();

export function setAway(phase: AwayPhase) {
  if (state.phase === phase) return;
  state = { phase, since: performance.now() };
  for (const l of listeners) l();
}

export function getAway() {
  return state;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const HOME = { phase: "home" as const, since: 0 };

export function usePipAway() {
  return useSyncExternalStore(subscribe, getAway, () => HOME);
}
