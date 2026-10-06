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
/** How far a target pulls the pointer: px it catches from, px it lets go at, and px a point of importance is worth. */
export type Reach = { catch: number; release: number; importancePx: number };
export const HUB_REACH: Reach = { catch: LOCK_CATCH, release: LOCK_RELEASE, importancePx: LOCK_IMPORTANCE_PX };
/** The zoom the first city names print from (engine CITY_FROM[0]): a city locks whenever its name is printed. */
export const CITY_LOCK_FROM = 0.1;
/**
 * The most a city pulls from, by zoom: from CITY_GRIP_FAR px as the first names print, a pebble the pointer skims over,
 * to CITY_GRIP_NEAR px just before the hubs take over, a stone it picks up.
 */
export const CITY_GRIP_FAR = 16;
export const CITY_GRIP_NEAR = 64;
/** The share of the way to the nearest other lockable city a city pulls from, so neighbours never fight over the pointer. */
export const CITY_SHARE = 0.4;
/** px a city always pulls from, its dot and the ring round it, however close its neighbour. */
export const CITY_REACH_MIN = 10;
/** How much further than catching a city lets go: with CITY_SHARE, still short of where its neighbour catches. */
export const CITY_RELEASE = 1.2;
/**
 * How strongly a city pulls the pointer at `zoom` with its nearest lockable neighbour `spacing` px away: the zoom's
 * grip, or less where cities crowd. Letting go is a little further than catching, and a bigger city pulls a little
 * harder.
 */
export function cityReach(zoom: number, spacing = Infinity): Reach {
  const k = Math.min(1, Math.max(0, (zoom - CITY_LOCK_FROM) / (LOCK_FROM[3] - CITY_LOCK_FROM)));
  const grip = CITY_GRIP_FAR + (CITY_GRIP_NEAR - CITY_GRIP_FAR) * k;
  const reach = Math.max(CITY_REACH_MIN, Math.min(grip, spacing * CITY_SHARE));
  return { catch: reach, release: reach * CITY_RELEASE, importancePx: reach * 0.15 };
}

/** Gives each city target its reach for `zoom`, from how far it is to the nearest other. */
export function reachCities(cities: LockTarget[], zoom: number) {
  for (const t of cities) {
    let spacing = Infinity;
    for (const o of cities) if (o !== t) spacing = Math.min(spacing, Math.hypot(o.x - t.x, o.y - t.y));
    t.reach = cityReach(zoom, spacing);
  }
}

/**
 * A place the pointer can lock on, where it is on screen and how far it pulls from: a hub (`hub`), or a city before
 * the hubs show (no hub). `importance` is 1 to 3, bigger counting nearer; `name` is what the pointer's label says.
 */
export type LockTarget = {
  id: string; importance: number; lat: number; lng: number; name: string; hub: Hub | null; x: number; y: number; reach: Reach;
};

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
    const target: LockTarget = { id: hub.id, importance: hub.importance, lat: hub.lat, lng: hub.lng, name: hubPreviewLabel(hub), hub, ...at, reach: HUB_REACH };
    out.push(target);
    const key = `${cx},${cy}`;
    cells.set(key, [...(cells.get(key) ?? []), target]);
  }
  return out;
}

/** A target's reach as it applies now: hovering or carrying pins, the target's own. */
export type ReachNow = (reach: Reach) => Reach;
const FULL_REACH: ReachNow = (reach) => reach;
/**
 * A target's reach while a plane is being flown: it catches readily, but only close up (35% of its reach, never under
 * 14 px nor over its own), so the plane sweeps on past places it isn't brought to, and lets go at 1.5 times that, so
 * it holds steady without flickering yet slides off with a nudge.
 */
export const FLYING_REACH: ReachNow = (reach) => {
  const near = Math.min(reach.catch, Math.max(reach.catch * 0.35, 14));
  return { catch: near, release: near * 1.5, importancePx: reach.importancePx * (near / reach.catch) };
};

/**
 * What the pointer at (x, y) is locked on: the held target until the pointer is past its release, else the best placed
 * within its catch (the nearest, bigger places counting a little nearer), else none. `now` gives each reach as it
 * applies at the moment (FLYING_REACH while flying).
 */
export function lockAt(
  targets: readonly LockTarget[], x: number, y: number, held: LockTarget | null, now: ReachNow = FULL_REACH,
): LockTarget | null {
  const d = (t: LockTarget) => Math.hypot(t.x - x, t.y - y);
  const score = (t: LockTarget) => d(t) - t.importance * now(t.reach).importancePx;
  let best: LockTarget | null = null;
  for (const t of targets) if (d(t) <= now(t.reach).catch && (!best || score(t) < score(best))) best = t;
  // the held one stays until the pointer is past its release, or another is clearly better placed
  const kept = held && targets.find((t) => t.id === held.id);
  if (kept && d(kept) <= now(kept.reach).release &&
    (!best || best === kept || score(best) > score(kept) - now(kept.reach).importancePx)) return kept;
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
