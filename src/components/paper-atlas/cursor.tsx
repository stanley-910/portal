import { useId, type CSSProperties } from "react";

import tokens from "@/design/tokens.json";
import { cn } from "@/lib/utils";

export type CursorShape = "arrow" | "compass" | "map";

/** Members' sticker colours, in the order they are handed out. */
export const MEMBER_COLORS = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"] as const;
export type MemberColor = (typeof MEMBER_COLORS)[number];

/** The colour for a member's slot, e.g. a Liveblocks connectionId. A seventh member starts again at member-1. */
export function memberColor(slot: number): MemberColor {
  const n = MEMBER_COLORS.length;
  return MEMBER_COLORS[((Math.trunc(slot) % n) + n) % n];
}

// Each shape is drawn with its tip, the hotspot, at 0 0, pointing up and to the left.
// "outline" is the ink edge; the parts are painted inside it.
type Paint = "member" | "face" | "shade" | "ink";
type Part = { d: string; paint: Paint; dashed?: boolean };
type ShapeDef = { outline: string; /** Degrees clockwise about the tip. */ rotate?: number; parts: Part[] };

const ARROW = "M0 0 L0 18 L4.6 14 L7.8 21 L11 19.6 L7.9 12.8 L13.6 12.6 Z";
// a paper map folded in three like an accordion; its top-left corner is the tip
const MAP = "M0 0 L5 2.2 L10 0 L15 2.2 L15 18.2 L10 16 L5 18.2 L0 16 Z";

const SHAPES: Record<CursorShape, ShapeDef> = {
  // a plain pointer cut from the member's paper
  arrow: {
    outline: ARROW,
    parts: [{ d: ARROW, paint: "member" }],
  },
  // a compass needle: the north half in the member's colour, the south half plain sticker, a pin at the pivot
  compass: {
    outline: "M0 0 L3.8 11 L0 25 L-3.8 11 Z",
    rotate: -24,
    parts: [
      { d: "M0 0 L3.8 11 L-3.8 11 Z", paint: "member" },
      { d: "M-3.8 11 L3.8 11 L0 25 Z", paint: "face" },
      { d: "M0 0 L3.8 11 L0 11 Z M0 11 L3.8 11 L0 25 Z", paint: "shade" },
      { d: "M-1.5 11 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0 Z", paint: "ink" },
    ],
  },
  // a folded paper map, tipped back so its corner points: the outer panels in the member's colour, the middle one
  // plain paper in shade, a dashed route across all three ending at a pin
  map: {
    outline: MAP,
    rotate: -8,
    parts: [
      { d: MAP, paint: "member" },
      { d: "M5 2.2 L10 0 L10 16 L5 18.2 Z", paint: "face" },
      { d: "M5 2.2 L10 0 L10 16 L5 18.2 Z", paint: "shade" },
      { d: "M2.4 13.4 L6.4 9.2 L9.2 11.4 L11.6 6.8", paint: "ink", dashed: true },
      { d: "M11.6 4.6 a1.6 1.6 0 1 0 0.01 0 Z", paint: "ink" },
    ],
  },
};

/** A cursor shape's outline, tip at 0 0 in CSS px, and its turn about the tip: for drawing its shadow elsewhere. */
export function cursorOutline(shape: CursorShape): { d: string; rotate: number } {
  return { d: SHAPES[shape].outline, rotate: SHAPES[shape].rotate ?? 0 };
}

/** The SVG's viewBox: the shape plus room for its shadow in the cursor image. One unit is one CSS pixel. */
const BOX = { x: -2, y: -2, size: 40 };
const VIEWBOX = `${BOX.x} ${BOX.y} ${BOX.size} ${BOX.size}`;

export interface CursorProps {
  shape?: CursorShape;
  color: MemberColor;
  /** The member's name, shown on a label beside the cursor. Omit for a bare cursor. */
  name?: string;
  /** How high it flies, 0 (touching the map) to 1. Sets how far off and soft its shadow falls; feed it terrain height to hug mountains. Default 0.5. */
  altitude?: number;
  /** Casts its own shadow. Off where the surface draws one, as the globe does. Default true. */
  cast?: boolean;
  /** Position of the tip in px, relative to the positioned parent. */
  x?: number;
  y?: number;
  className?: string;
  style?: CSSProperties;
}

/** Another trip member's pointer: a sticker in their colour, with their name on a label. */
export function Cursor({ shape = "arrow", color, name, altitude = 0.5, cast = true, x = 0, y = 0, className, style }: CursorProps) {
  const clipId = "pa-cursor-" + useId().replace(/[^A-Za-z0-9_-]/g, "");
  const def = SHAPES[shape];
  return (
    <div
      className={cn("pa-cursor", cast && "pa-cast", className)}
      style={{ "--member": `var(--${color})`, "--alt": altitude, transform: `translate(${x}px, ${y}px)`, ...style } as CSSProperties}
      aria-hidden
    >
      <svg className="pa-cursor-sticker" width={BOX.size} height={BOX.size} viewBox={VIEWBOX}>
        <defs>
          {/* the clip is used inside the transformed group, so it is drawn untransformed */}
          <clipPath id={clipId}>
            <path d={def.outline} />
          </clipPath>
        </defs>
        <g transform={def.rotate ? `rotate(${def.rotate})` : undefined}>
          <g clipPath={`url(#${clipId})`}>
            {def.parts.map((p, i) => (
              <path key={i} className={cn(`pa-cursor-${p.paint}`, p.dashed && "pa-cursor-dashed")} d={p.d} />
            ))}
          </g>
          <path className="pa-cursor-outline" d={def.outline} />
        </g>
      </svg>
      {name && <span className="pa-cursor-name">{name}</span>}
    </div>
  );
}

// Cursor images can't read CSS variables, so the local cursor resolves tokens to values here.
type ThemeId = "light" | "dark";
type TokenValue = string | Partial<Record<ThemeId, string>>;
const byName = new Map<string, TokenValue>(
  [...tokens.color.tokens, ...tokens.line.tokens].map((t) => [t.name, t.value as TokenValue]),
);
function token(name: string, theme: ThemeId): string {
  const v = byName.get(name);
  if (v === undefined) throw new Error(`Unknown design token: ${name}`);
  const raw = typeof v === "string" ? v : (v[theme] ?? v.light ?? "");
  const alias = /^\{(.+)\}$/.exec(raw);
  return alias ? token(alias[1], theme) : raw;
}

// Chromium hides a cursor image bigger than 32 px whenever any of it would fall outside the window, so each image
// is cut to fit what it draws, with the tip wherever that puts it: a cursor pulled to the left reaches far left of
// the pointer but hardly right of it. A plain cursor is drawn in PLAIN_BOX, which just holds the shape and its
// shadow with the tip in its corner, and shows right up to the window's edge. Browsers take images up to 128 px.
type Box = { x: number; y: number; w: number; h: number };
const PLAIN_BOX: Box = { x: -2, y: -2, w: 32, h: 32 };
// room left round the drawing for its outline's width, and for its shadow's blur
const BOX_EDGE = 2;
const BLUR_EDGE = 4;
const urls = new Map<string, string>();

/** How a cursor lies on a curved surface: squashed about its tip to `squash` across a long axis `angle` degrees clockwise. */
export interface CursorLie {
  angle: number;
  squash: number;
}

export interface CursorUrlOptions {
  /** Lays it on a curve, the way a circle on a globe becomes an ellipse. `squash` runs 0.4 to 1.3. */
  lie?: CursorLie;
  /** Draws it this many px off the pointer, within ±32. */
  offset?: [number, number];
  /** A ring on the ground around the tip, lying as given; `squash` runs 0 to 1. */
  marker?: CursorLie | null;
  /** Leave the shadow out, for a surface that draws its own. */
  noShadow?: boolean;
  /** Pulls it off a surface like taffy; drawn instead of `lie`. */
  pull?: CursorPull | null;
}

/**
 * A cursor being pulled off a surface like taffy. Its end nearest the surface stays stuck where it lay and its far
 * end goes with the pointer, so the body between them draws out thin. `angle`: the pull's direction, degrees
 * clockwise from rightward, away from the surface. `gap`: px the far end has moved out from where it lay, so how
 * far the near end is held back from the pointer; negative while it springs past. `flat`: how squashed along the
 * pull it lay on the surface, 0.4 to 1, as a lie across the pull would squash it; the stuck part stays so, and the
 * part that has peeled off rises to its full length.
 */
export interface CursorPull {
  angle: number;
  gap: number;
  flat: number;
}

/**
 * A CSS `cursor` value that turns the viewer's own pointer into a cursor sticker, e.g.
 * `style={{ cursor: cursorUrl("compass", memberColor(me), theme) }}`. Falls back to the system arrow.
 */
export function cursorUrl(
  shape: CursorShape,
  color: MemberColor,
  theme: ThemeId = "light",
  { lie = { angle: 0, squash: 1 }, offset = [0, 0], marker = null, noShadow = false, pull = null }: CursorUrlOptions = {},
): string {
  const ring = marker ? `${marker.angle} ${marker.squash}` : "-";
  const pulled = pull ? `${pull.angle} ${pull.gap} ${pull.flat}` : "-";
  const key = `${shape} ${color} ${theme} ${lie.angle} ${lie.squash} ${offset} ${ring} ${noShadow} ${pulled}`;
  let url = urls.get(key);
  if (!url) {
    if (urls.size >= 1024) urls.delete(urls.keys().next().value!);
    const box = imageBox(shape, { lie, offset, marker, noShadow, pull });
    urls.set(key, (url = buildCursorUrl(shape, color, theme, lie, offset, marker, noShadow, pull, box)));
  }
  return url;
}

/** The box a cursor image is drawn in, in px about the tip: just big enough for what it draws. */
function imageBox(
  shape: CursorShape,
  { lie = { angle: 0, squash: 1 }, offset = [0, 0], marker = null, noShadow = false, pull = null }: CursorUrlOptions,
): Box {
  if (lie.squash === 1 && offset[0] === 0 && offset[1] === 0 && !marker && !pull) return PLAIN_BOX;
  const def = SHAPES[shape];
  let body: [number, number][];
  if (pull) {
    const n = pulledShape(shape, pull).outline.match(/-?\d*\.?\d+/g)!.map(Number);
    body = n.flatMap((_, i) => (i % 2 ? [] : [[n[i], n[i + 1]] as [number, number]]));
  } else {
    const r = ((def.rotate ?? 0) * Math.PI) / 180;
    const [a, b, c, d] = cursorLieMatrix(lie);
    body = segments(def.outline).flatMap((seg) => {
      if (seg.k !== "M" && seg.k !== "L") return [];
      const [x0, y0] = seg.p;
      const x = x0 * Math.cos(r) - y0 * Math.sin(r), y = x0 * Math.sin(r) + y0 * Math.cos(r);
      return [[a * x + c * y, b * x + d * y] as [number, number]];
    });
  }
  let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
  const take = (x: number, y: number, edge: number) => {
    x0 = Math.min(x0, x - edge);
    y0 = Math.min(y0, y - edge);
    x1 = Math.max(x1, x + edge);
    y1 = Math.max(y1, y + edge);
  };
  if (marker) take(0, 0, 8 + BOX_EDGE);
  for (const [x, y] of body) {
    take(x + offset[0], y + offset[1], BOX_EDGE);
    if (!noShadow) take(x + offset[0] + 6, y + offset[1] + 8, BLUR_EDGE);
  }
  const x = Math.floor(x0), y = Math.floor(y0);
  return { x, y, w: Math.ceil(x1) - x, h: Math.ceil(y1) - y };
}

/**
 * How far a cursor image reaches from the pointer, in px, and whether it's big enough (over 32 px) that Chromium
 * hides it when any of it would fall outside the window.
 */
export function cursorImageReach(shape: CursorShape, options: CursorUrlOptions = {}) {
  const { x, y, w, h } = imageBox(shape, options);
  return { left: -x, up: -y, right: x + w, down: y + h, big: w > 32 || h > 32 };
}

type Seg = { k: "M" | "L"; p: [number, number] } | { k: "a"; r: number[]; d: [number, number] } | { k: "Z" };

/** The shapes' paths use only absolute M and L, relative a (for small circles) and Z. */
function segments(d: string): Seg[] {
  const tok = d.match(/[MLZa]|-?\d*\.?\d+/g)!;
  const out: Seg[] = [];
  for (let i = 0; i < tok.length; ) {
    const k = tok[i++];
    if (k === "Z") out.push({ k });
    else if (k === "a") {
      const n = tok.slice(i, (i += 7)).map(Number);
      out.push({ k, r: n.slice(0, 5), d: [n[5], n[6]] });
    } else out.push({ k: k as "M" | "L", p: [+tok[i++], +tok[i++]] });
  }
  return out;
}

// Pulled, the share of a cursor's length nearest the surface stays where it lay; past it, the rest draws out after
// the pointer, more the further along it is, so its leading end reaches out to where it lay beside the pointer.
const HOLD = 0.6;
// As it's pulled one of its own lengths out, it rises this share of the way from lying flat.
const RISE = 0.5;
// The drawn-out end narrows toward its leading point, down to this share of its width.
const THIN = 0.15;
// Edges are cut into pieces this long (px) so the body can taper and bend.
const WARP_STEP = 1.2;
const pulls = new Map<string, { outline: string; parts: string[] }>();

function smooth(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * A cursor shape pulled like taffy, its paths in px about the tip with its turn applied. It's the same whichever
 * way it's pulled: the body stays stuck where it lay on the surface, held back `gap` from the pointer, and its
 * leading end, whichever part faces the pull, draws out thin to where it lay beside the pointer. A negative gap,
 * as it springs back past, bunches the leading end up instead.
 */
function pulledShape(shape: CursorShape, pull: CursorPull) {
  const key = `${shape} ${pull.angle} ${pull.gap} ${pull.flat}`;
  const hit = pulls.get(key);
  if (hit) return hit;
  const def = SHAPES[shape];
  const r = ((def.rotate ?? 0) * Math.PI) / 180;
  const turn = ([x, y]: [number, number]): [number, number] =>
    [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
  const dot = (a: [number, number], b: [number, number]) => a[0] * b[0] + a[1] * b[1];
  const a = (pull.angle * Math.PI) / 180;
  const u: [number, number] = [Math.cos(a), Math.sin(a)];
  const n: [number, number] = [-u[1], u[0]];
  const { gap, flat } = pull;
  const corners = segments(def.outline).flatMap((s) => (s.k === "M" || s.k === "L" ? [turn(s.p)] : []));
  // the shape's reach along the pull: pMin is the end nearest the surface, pMax the leading end
  const pMin = Math.min(...corners.map((p) => dot(p, u)));
  const pMax = Math.max(...corners.map((p) => dot(p, u)));
  const span = pMax - pMin || 1;
  // the leading point, across the pull, which the drawn-out part narrows toward: of the corners that lead, the one
  // nearest the tip, so the strand reaches toward the pointer
  const leading = corners.filter((p) => dot(p, u) >= pMax - 0.1 * span);
  const lead = dot(leading.reduce((x, y) => (Math.hypot(...y) < Math.hypot(...x) ? y : x)), n);
  // risen part of the way off the surface, about the stuck end so it doesn't slide
  const rise = flat + (1 - flat) * RISE * Math.min(1, Math.max(0, gap) / span);
  // how much further the leading end reaches than the risen body, to get back beside the pointer
  const reach = gap + pMin * (rise - flat);
  const drawn = Math.min(1, reach / span);
  const warp = (q0: [number, number]): [number, number] => {
    const q = turn(q0);
    const w = smooth(HOLD, 1, (dot(q, u) - pMin) / span);
    const t = pMin * flat - gap + (dot(q, u) - pMin) * rise + w * reach;
    // drawn out it narrows; pushed back past it bulges a little
    const k = drawn >= 0 ? 1 - (1 - THIN) * w * drawn : 1 - 0.25 * w * Math.max(-1, drawn);
    const c = lead + (dot(q, n) - lead) * k;
    return [u[0] * t + n[0] * c, u[1] * t + n[1] * c];
  };
  const fmt = (p: [number, number]) => `${+p[0].toFixed(2)} ${+p[1].toFixed(2)}`;
  const redraw = (path: string) => {
    let out = "";
    let at: [number, number] = [0, 0];
    let start = at;
    const lineTo = (q: [number, number], close: boolean) => {
      const n = Math.max(1, Math.ceil(Math.hypot(q[0] - at[0], q[1] - at[1]) / WARP_STEP));
      for (let i = 1; i <= (close ? n - 1 : n); i++) {
        out += `L${fmt(warp([at[0] + ((q[0] - at[0]) * i) / n, at[1] + ((q[1] - at[1]) * i) / n]))}`;
      }
      at = q;
    };
    for (const s of segments(path)) {
      if (s.k === "M") {
        at = start = s.p;
        out += `M${fmt(warp(at))}`;
      } else if (s.k === "L") lineTo(s.p, false);
      else if (s.k === "Z") {
        lineTo(start, true);
        out += "Z";
      } else if (s.k === "a") {
        // a small circle rides along on its warped start, keeping its size
        const d = turn(s.d);
        out += `a${s.r.join(" ")} ${fmt(d)}`;
        at = [at[0] + s.d[0], at[1] + s.d[1]];
      }
    }
    return out;
  };
  const shape2 = { outline: redraw(def.outline), parts: def.parts.map((p) => redraw(p.d)) };
  if (pulls.size >= 512) pulls.delete(pulls.keys().next().value!);
  pulls.set(key, shape2);
  return shape2;
}

/** A pulled cursor's outline, in px about the tip, for drawing its shadow elsewhere. */
export function cursorPullOutline(shape: CursorShape, pull: CursorPull): string {
  return pulledShape(shape, pull).outline;
}

/** The 2D matrix [a, b, c, d] that keeps lengths along the lie's long axis and scales those across it by its squash. */
export function cursorLieMatrix({ angle, squash }: CursorLie): [number, number, number, number] {
  const a = (angle * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a), k = 1 - squash;
  return [1 - k * s * s, k * c * s, k * c * s, 1 - k * c * c];
}

/** The ring that marks the ground under the tip: r 8 px, flattened by its lie, with a dot at the centre. */
function markerSvg(marker: CursorLie, ink: string) {
  const m = cursorLieMatrix(marker).map((x) => +x.toFixed(4)).join(" ");
  return (
    `<g transform="matrix(${m} 0 0)">` +
    `<circle r="8" fill="none" stroke="${ink}" stroke-opacity="0.7" stroke-width="1.2" vector-effect="non-scaling-stroke"/>` +
    `<circle r="1.6" fill="${ink}"/></g>`
  );
}

function buildCursorUrl(
  shape: CursorShape,
  color: MemberColor,
  theme: ThemeId,
  lie: CursorLie,
  offset: [number, number],
  marker: CursorLie | null,
  noShadow: boolean,
  pull: CursorPull | null,
  box: Box,
): string {
  const def = SHAPES[shape];
  // pulled, the paths come already turned and stretched
  const drawn = pull ? pulledShape(shape, pull) : null;
  const outline = drawn ? drawn.outline : def.outline;
  const t = (name: string) => token(name, theme);
  const paint: Record<Paint, string> = {
    member: `fill="${t(color)}"`,
    face: `fill="${t("sticker-fill")}"`,
    shade: `fill="${t("sticker-ink")}" fill-opacity="0.16"`,
    ink: `fill="${t("sticker-ink")}"`,
  };
  const dashed = `fill="none" stroke="${t("sticker-ink")}" stroke-width="1.2" stroke-linecap="round" stroke-dasharray="1.6 1.6"`;
  const m = cursorLieMatrix(lie).map((x) => +x.toFixed(4)).join(" ");
  const g = drawn ? "" : ` transform="matrix(${m} 0 0)${def.rotate ? ` rotate(${def.rotate})` : ""}"`;
  const parts = def.parts
    .map((p, i) => `<path d="${drawn ? drawn.parts[i] : p.d}" ${p.dashed ? dashed : paint[p.paint]}/>`)
    .join("");
  // the shadow of a cursor flying at altitude 0.5, as the .pa-cast rule draws it
  const shadow = `<filter id="s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.2"/></filter>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}">` +
    (marker ? markerSvg(marker, t("ink")) : "") +
    `<g transform="translate(${offset[0]} ${offset[1]})">` +
    `<defs><clipPath id="c"><path d="${outline}"${g}/></clipPath>${shadow}</defs>` +
    (noShadow ? "" : `<g transform="translate(6 8)" filter="url(#s)"><path${g} d="${outline}" fill="${t("sticker-shadow")}"/></g>`) +
    `<g clip-path="url(#c)"><g${g}>${parts}</g></g>` +
    `<g${g}><path d="${outline}" fill="none" stroke="${t("sticker-ink")}" stroke-width="${parseFloat(t("line-ink"))}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></g>` +
    `</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${-box.x} ${-box.y}, default`;
}
