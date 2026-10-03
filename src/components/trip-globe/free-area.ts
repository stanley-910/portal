// The largest open rectangle of the globe's box that the page leaves uncovered, so a landed route can be framed
// where people can see it. Coverage is sampled on a grid, so nothing has to register as a panel: whatever is on
// top at a point and isn't the globe covers it. Covered cells grow by one cell, to keep a gap from panels.

export type Rect = { x: number; y: number; w: number; h: number };

/** Grid spacing in CSS px: fine enough for panel edges, coarse enough to sample in a few milliseconds. */
export const STEP = 24;
/** Smallest open area worth framing a route in, either way. */
const MIN = 160;

/** `covered(x, y)` says whether the point x, y (in the box's own px) is under something other than the globe. */
export function openArea(w: number, h: number, covered: (x: number, y: number) => boolean, step = STEP): Rect | null {
  const cols = Math.floor(w / step);
  const rows = Math.floor(h / step);
  if (!cols || !rows) return null;
  const hit: boolean[][] = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => covered((c + 0.5) * step, (r + 0.5) * step)));
  const near = (r: number, c: number) => {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (hit[r + dr]?.[c + dc]) return true;
    return false;
  };

  // largest rectangle of open cells: each row's run of open cells above it is a histogram, solved with a stack
  const heights = new Array<number>(cols).fill(0);
  let best = { area: 0, r: 0, c: 0, cw: 0, ch: 0 };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) heights[c] = near(r, c) ? 0 : heights[c] + 1;
    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const hc = c < cols ? heights[c] : 0;
      while (stack.length && heights[stack.at(-1)!] >= hc) {
        const top = stack.pop()!;
        const ch = heights[top];
        const left = stack.length ? stack.at(-1)! + 1 : 0;
        const cw = c - left;
        if (cw * ch > best.area) best = { area: cw * ch, r: r - ch + 1, c: left, cw, ch };
      }
      stack.push(c);
    }
  }
  if (best.cw * step < MIN || best.ch * step < MIN) return null;
  return { x: best.c * step, y: best.r * step, w: best.cw * step, h: best.ch * step };
}
