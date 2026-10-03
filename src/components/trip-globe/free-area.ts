// The largest open rectangle of the globe's box that the page leaves uncovered, so a landed route can be framed
// where people can see it. Registered panel rectangles cover a geometry-only grid. Covered cells grow by one
// cell to keep a gap from panels; no per-cell DOM hit testing is needed.

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

/** Geometry-only counterpart: one rectangle read per registered panel, no point hit testing. */
export function openAreaAround(w: number, h: number, obstacles: readonly Rect[]): Rect | null {
  return openArea(w, h, (x, y) => obstacles.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h));
}

/** Panels opt in with data-globe-obstacle; route-following cards intentionally never obstruct their own route. */
export class GlobeObstacles {
  private elements: Element[] = [];
  private dirty = true;
  private area: Rect | null = null;
  private resize: ResizeObserver;
  private structure: MutationObserver;
  private attributes: MutationObserver;
  private stopped = false;

  constructor(private root: HTMLElement, private onChange: () => void) {
    this.resize = new ResizeObserver(this.invalidate);
    this.attributes = new MutationObserver(this.invalidate);
    this.structure = new MutationObserver((records) => {
      // Text streaming and unrelated subtree changes never invalidate panel geometry.
      const relevant = records.some((r) => [...r.addedNodes, ...r.removedNodes].some((n) =>
        n instanceof Element && (n.matches("[data-globe-obstacle]") || !!n.querySelector("[data-globe-obstacle]"))));
      if (relevant) this.register();
    });
    this.structure.observe(document.body, { childList: true, subtree: true });
    this.register();
    window.addEventListener("resize", this.invalidate);
  }

  private register() {
    this.resize.disconnect();
    this.attributes.disconnect();
    this.resize.observe(this.root);
    this.elements = [...document.querySelectorAll("[data-globe-obstacle]")].filter((el) =>
      !this.root.contains(el) && !el.closest("[data-globe-follow], [data-globe-float]"));
    for (const el of this.elements) {
      this.resize.observe(el);
      // Position and hidden-state changes may not resize a panel. Observe its ancestors as well.
      for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
        this.attributes.observe(node, { attributes: true, attributeFilter: ["style", "class", "hidden", "open", "inert"] });
      }
    }
    this.invalidate();
  }

  private invalidate = () => {
    if (this.stopped) return;
    this.dirty = true;
    this.onChange();
  };

  read = (): Rect | null => {
    if (!this.dirty) return this.area;
    this.dirty = false;
    const root = this.root.getBoundingClientRect();
    const obstacles: Rect[] = [];
    for (const el of this.elements) {
      if (el.closest("[hidden], [inert]") || !el.getClientRects().length || getComputedStyle(el).visibility === "hidden") continue;
      const box = el.getBoundingClientRect();
      obstacles.push({ x: box.left - root.left, y: box.top - root.top, w: box.width, h: box.height });
    }
    this.area = openAreaAround(root.width, root.height, obstacles);
    return this.area;
  };

  destroy() {
    this.stopped = true;
    this.structure.disconnect();
    this.attributes.disconnect();
    this.resize.disconnect();
    window.removeEventListener("resize", this.invalidate);
  }
}
