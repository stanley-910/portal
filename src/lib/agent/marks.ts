// What Pip changed, as the globe shows it: each change pops up over the place it happened, like a hit in a game
// ("Removed Seoul → Tokyo"), while Pip's saucer hovers there. Made where the edit is made (edit.ts, solo.ts) and
// played by the saucer (components/agent/pip-saucer.tsx).

type Point = { lat: number; lng: number };

export type AgentMark = {
  /** The change, short: "Added HK West Kowloon → Shanghai". */
  text: string;
  /** Where on the globe it happened. Null pops it wherever the saucer is. */
  at: Point | null;
  /** A leg the saucer draws out: which of the legs added at once it is, in the order they draw (trip order). */
  drawn?: number;
};

const R = Math.PI / 180;

/**
 * How long Pip gives its saucer to reach a place before changing the trip there, so the change lands under it rather
 * than ahead of it.
 */
export const SAUCER_FLY_MS = 900;

/** The same, when the saucer first comes out and flies in from off the screen (engine.ts UFO_ENTER, plus a beat). */
export const SAUCER_ENTER_MS = 1600;

/** How long a new leg takes to draw out behind the saucer, from its start to its end (engine.ts DRAW). */
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

/** The marks for a trip on the home globe changing from one list of legs to another. */
export function legMarks(before: { from: Point & { name: string }; to: Point & { name: string } }[], after: typeof before): AgentMark[] {
  const key = (l: (typeof before)[number]) => `${l.from.lat},${l.from.lng}>${l.to.lat},${l.to.lng}`;
  const had = new Set(before.map(key));
  const has = new Set(after.map(key));
  // over where the leg ends, where its pin drops
  const mark = (did: string, l: (typeof before)[number]): AgentMark => ({ text: `${did} ${l.from.name} → ${l.to.name}`, at: { lat: l.to.lat, lng: l.to.lng } });
  return [
    ...before.filter((l) => !has.has(key(l))).map((l) => mark("Removed", l)),
    ...after.filter((l) => !had.has(key(l))).map((l, i) => ({ ...mark("Added", l), drawn: i })),
  ];
}
