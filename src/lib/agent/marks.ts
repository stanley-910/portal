// What Pip changed, as the globe shows it: each change pops up over the place it happened, like a hit in a game
// ("Removed Seoul → Tokyo"), while Pip's saucer hovers there. Made where the edit is made (edit.ts, solo.ts) and
// played by the saucer (components/agent/pip-saucer.tsx).

type Point = { lat: number; lng: number };

export type AgentMark = {
  /** The change, short: "Added HK West Kowloon → Shanghai". */
  text: string;
  /** Where on the globe it happened. Null pops it wherever the saucer is. */
  at: Point | null;
  /**
   * The leg this change put on the globe, or took off it (`gone`): the saucer pops it once the globe has finished
   * drawing its line out, or reeling it in.
   */
  leg?: { from: Point; to: Point; gone?: boolean };
};

const R = Math.PI / 180;

/**
 * How long Pip gives its saucer to reach a place before changing the trip there, so the change lands under it rather
 * than ahead of it.
 */
export const SAUCER_FLY_MS = 900;

/** The same, when the saucer first comes out and flies in from off the screen (engine.ts UFO_ENTER, plus a beat). */
export const SAUCER_ENTER_MS = 1600;

/** How long a new leg takes to draw out behind the saucer, or a removed one to reel in (engine.ts PIP_DRAW). */
export const SAUCER_DRAW_MS = 1600;


/** How long the saucer stays over a change once it lands, before Pip flies on to the next. */
export const SAUCER_STAY_MS = 800;

/** The middle of the great circle between two places: where a leg's mark goes. */
export function midpoint(a: Point, b: Point): Point {
  const v = (p: Point) => [Math.cos(p.lat * R) * Math.sin(p.lng * R), Math.sin(p.lat * R), Math.cos(p.lat * R) * Math.cos(p.lng * R)];
  const [x, y, z] = v(a).map((c, i) => c + v(b)[i]);
  const l = Math.hypot(x, y, z);
  // the two ends of a diameter have no one middle: take the first
  if (l < 1e-9) return { lat: a.lat, lng: a.lng };
  return { lat: Math.asin(y / l) / R, lng: Math.atan2(x, z) / R };
}

type Leg = { from: Point & { name: string }; to: Point & { name: string } };

/**
 * The legs that went and the legs that came when a trip changes from `before` to `after`, in the order Pip's saucer
 * plays them: the ones that went from the trip's end back, so a run of them reels in in one sweep, ending where the
 * new ones start; then the ones that came, in trip order. The globe engine plays them in the same order.
 */
export function legChanges<L extends Leg>(before: L[], after: L[]) {
  const key = (l: Leg) => `${l.from.lat},${l.from.lng}>${l.to.lat},${l.to.lng}`;
  const had = new Set(before.map(key));
  const has = new Set(after.map(key));
  return { removed: before.filter((l) => !has.has(key(l))).reverse(), added: after.filter((l) => !had.has(key(l))) };
}

/** Where the saucer starts on a trip changing from `before` to `after`: the end of the last leg that went, else the start of the first that came. */
export function changeStart(before: Leg[], after: Leg[]): Point | null {
  const { removed, added } = legChanges(before, after);
  const at = removed[0]?.to ?? added[0]?.from;
  return at ? { lat: at.lat, lng: at.lng } : null;
}

/**
 * The marks for a trip on the home globe changing from one list of legs to another, in the order the saucer plays
 * them: a leg that went pops at its start, where it has reeled back to, and one that came at its end, where its pin
 * drops.
 */
export function legMarks(before: Leg[], after: Leg[]): AgentMark[] {
  const { removed, added } = legChanges(before, after);
  const text = (did: string, l: Leg) => `${did} ${l.from.name} → ${l.to.name}`;
  const p = (x: Point) => ({ lat: x.lat, lng: x.lng });
  return [
    ...removed.map((l) => ({ text: text("Removed", l), at: p(l.from), leg: { from: p(l.from), to: p(l.to), gone: true } })),
    ...added.map((l) => ({ text: text("Added", l), at: p(l.to), leg: { from: p(l.from), to: p(l.to) } })),
  ];
}
