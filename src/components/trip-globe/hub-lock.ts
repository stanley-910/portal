// Locking on: the pointer snaps to a place near it, so a click, a stop or a dropped pin lands right on it. With the
// cities named on the globe it locks on to a city, and the search looks around it; zoomed in on a country, to an
// airport, station or ferry terminal, which that end of the leg then searches exactly. Pure apart from the haptic
// tick; the engine feeds it screen positions.
import { HUBS } from "@/lib/transport/hubs/browser";
import { hubPreviewLabel } from "@/lib/transport/hubs/preview";
import type { Hub } from "@/lib/transport/hubs/types";

/**
 * The zoom (0 whole globe, 1 closest) each hub importance becomes lockable from: large hubs once a country and its
 * neighbours fill the view, regional ones only at the closest.
 */
export const LOCK_FROM: Record<number, number> = { 3: 0.82, 2: 0.93, 1: 0.99 };
/** px two lockable hubs keep apart on screen; the more important, then the first by id, keeps its place. */
export const LOCK_SPACING = 18;
/**
 * px from a hub the pointer catches it, and how far it can wander before it lets go: it pulls in from well off and lets
 * go soon after. Letting go is never closer than catching, or it would catch again on the spot.
 */
export const LOCK_CATCH = 26;
export const LOCK_RELEASE = 30;
/** px of pointer distance a point of importance is worth when two hubs are in reach: SeaTac before Boeing Field. */
export const LOCK_IMPORTANCE_PX = 4;
/**
 * The same for cities, which are far fewer and further apart on screen: anywhere round a named city locks on to it
 * until another is clearly nearer, a bigger city pulling from further.
 */
export const CITY_LOCK = { catch: 150, release: 170, importancePx: 15 };

/**
 * A place the pointer can lock on, where it is on screen: a hub (`hub`), or a city before the hubs show (no hub).
 * `importance` is 1 to 3, bigger counting nearer; `name` is what the pointer's label says.
 */
export type LockTarget = { id: string; importance: number; lat: number; lng: number; name: string; hub: Hub | null; x: number; y: number };

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
    const target: LockTarget = { id: hub.id, importance: hub.importance, lat: hub.lat, lng: hub.lng, name: hubPreviewLabel(hub), hub, ...at };
    out.push(target);
    const key = `${cx},${cy}`;
    cells.set(key, [...(cells.get(key) ?? []), target]);
  }
  return out;
}

/**
 * What the pointer at (x, y) is locked on: the held target until the pointer is LOCK_RELEASE px away from it, else the
 * best placed within LOCK_CATCH (the nearest, bigger places counting a little nearer), else none.
 */
export function lockAt(
  targets: readonly LockTarget[], x: number, y: number, held: LockTarget | null,
  reach = { catch: LOCK_CATCH, release: LOCK_RELEASE, importancePx: LOCK_IMPORTANCE_PX },
): LockTarget | null {
  const d = (t: LockTarget) => Math.hypot(t.x - x, t.y - y);
  const score = (t: LockTarget) => d(t) - t.importance * reach.importancePx;
  let best: LockTarget | null = null;
  for (const t of targets) if (d(t) <= reach.catch && (!best || score(t) < score(best))) best = t;
  // the held one stays until the pointer is past its release, or another is clearly better placed
  const kept = held && targets.find((t) => t.id === held.id);
  if (kept && d(kept) <= reach.release && (!best || best === kept || score(best) > score(kept) - reach.importancePx)) return kept;
  return best;
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
