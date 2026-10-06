// Locking on to a hub: zoomed in, the pointer snaps to the airport, station or ferry terminal near it, so a click,
// a stop or a dropped pin lands on that hub and its leg searches exactly it. Zoomed out it never locks, and a click
// searches the hubs around where it lands. Pure apart from the haptic tick; the engine feeds it screen positions.
import { HUBS } from "@/lib/transport/hubs/browser";
import type { Hub } from "@/lib/transport/hubs/types";

/** The zoom (0 whole globe, 1 closest) each hub importance becomes lockable from: large hubs first, regional ones last. */
export const LOCK_FROM: Record<number, number> = { 3: 0.45, 2: 0.75, 1: 0.92 };
/** px two lockable hubs keep apart on screen; the more important, then the first by id, keeps its place. */
export const LOCK_SPACING = 18;
/** px from a hub the pointer catches it, and how far it can wander before it lets go. */
export const LOCK_CATCH = 16;
export const LOCK_RELEASE = 28;
/** px of pointer distance a point of importance is worth when two hubs are in reach: SeaTac before Boeing Field. */
export const LOCK_IMPORTANCE_PX = 4;

/** A lockable hub where it is on screen. */
export type LockTarget = { hub: Hub; x: number; y: number };

// most important first, then by id, so the spacing keeps the same hubs however the view got there
const RANKED = [...HUBS].sort((a, b) => b.importance - a.importance || (a.id < b.id ? -1 : 1));

/**
 * The hubs that can be locked on at `zoom`, placed on screen by `place` (null when hidden or off screen): the ones
 * important enough for the zoom, each at least LOCK_SPACING px from those before it.
 */
export function lockTargets(zoom: number, place: (hub: Hub) => { x: number; y: number } | null, hubs: readonly Hub[] = RANKED): LockTarget[] {
  const out: LockTarget[] = [];
  // placed hubs by LOCK_SPACING-sized cell, so each new one checks only the cells round its own
  const cells = new Map<string, LockTarget[]>();
  const crowded = (x: number, y: number, cx: number, cy: number) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const t of cells.get(`${cx + i},${cy + j}`) ?? []) if (Math.hypot(t.x - x, t.y - y) < LOCK_SPACING) return true;
    }
    return false;
  };
  for (const hub of hubs) {
    if (zoom < (LOCK_FROM[hub.importance] ?? Infinity)) continue;
    const at = place(hub);
    if (!at) continue;
    const cx = Math.floor(at.x / LOCK_SPACING), cy = Math.floor(at.y / LOCK_SPACING);
    if (crowded(at.x, at.y, cx, cy)) continue;
    const target = { hub, ...at };
    out.push(target);
    const key = `${cx},${cy}`;
    cells.set(key, [...(cells.get(key) ?? []), target]);
  }
  return out;
}

/**
 * The hub the pointer at (x, y) is locked on: the held one until the pointer is LOCK_RELEASE px away from it, else the
 * best placed within LOCK_CATCH (the nearest, bigger hubs counting a little nearer), else none.
 */
export function lockAt(targets: readonly LockTarget[], x: number, y: number, held: Hub | null): Hub | null {
  const d = (t: LockTarget) => Math.hypot(t.x - x, t.y - y);
  const kept = held && targets.find((t) => t.hub.id === held.id);
  if (kept && d(kept) <= LOCK_RELEASE) return held;
  const score = (t: LockTarget) => d(t) - t.hub.importance * LOCK_IMPORTANCE_PX;
  let best: LockTarget | null = null;
  for (const t of targets) if (d(t) <= LOCK_CATCH && (!best || score(t) < score(best))) best = t;
  return best?.hub ?? null;
}

/**
 * A short tick as a lock catches, where the device can give one (Android phones). Browsers on macOS give a page no
 * way to the trackpad's Taptic Engine, so there the lock shows only on screen.
 */
export function lockTick() {
  try {
    navigator.vibrate?.(8);
  } catch {}
}
