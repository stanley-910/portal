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
type ShapeDef = { outline: string; transform?: string; parts: Part[] };

const ARROW = "M0 0 L0 18 L4.6 14 L7.8 21 L11 19.6 L7.9 12.8 L13.6 12.6 Z";

const SHAPES: Record<CursorShape, ShapeDef> = {
  // a plain pointer cut from the member's paper
  arrow: { outline: ARROW, parts: [{ d: ARROW, paint: "member" }] },
  // a compass needle: the north half in the member's colour, the south half plain sticker, a pin at the pivot
  compass: {
    outline: "M0 0 L3.8 11 L0 25 L-3.8 11 Z",
    transform: "rotate(-24)",
    parts: [
      { d: "M0 0 L3.8 11 L-3.8 11 Z", paint: "member" },
      { d: "M-3.8 11 L3.8 11 L0 25 Z", paint: "face" },
      { d: "M0 0 L3.8 11 L0 11 Z M0 11 L3.8 11 L0 25 Z", paint: "shade" },
      { d: "M-1.5 11 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0 Z", paint: "ink" },
    ],
  },
  // the arrow folded like a road map: two creases, alternate panels in shade, a dashed route across it
  map: {
    outline: ARROW,
    parts: [
      { d: ARROW, paint: "member" },
      { d: "M0 6.5 L6.5 0 L13 6.5 L0 19.5 Z", paint: "shade" },
      { d: "M2.2 15.2 L6.2 9.4 L9.4 11.4", paint: "ink", dashed: true },
    ],
  },
};

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
  /** Position of the tip in px, relative to the positioned parent. */
  x?: number;
  y?: number;
  className?: string;
  style?: CSSProperties;
}

/** Another trip member's pointer: a sticker in their colour, with their name on a label. */
export function Cursor({ shape = "arrow", color, name, altitude = 0.5, x = 0, y = 0, className, style }: CursorProps) {
  const clipId = "pa-cursor-" + useId().replace(/[^A-Za-z0-9_-]/g, "");
  const def = SHAPES[shape];
  return (
    <div
      className={cn("pa-cursor pa-cast", className)}
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
        <g transform={def.transform}>
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

/**
 * A CSS `cursor` value that turns the viewer's own pointer into a cursor sticker, e.g.
 * `style={{ cursor: cursorUrl("compass", memberColor(me), theme) }}`. Falls back to the system arrow.
 */
export function cursorUrl(shape: CursorShape, color: MemberColor, theme: ThemeId = "light"): string {
  const def = SHAPES[shape];
  const t = (name: string) => token(name, theme);
  const paint: Record<Paint, string> = {
    member: `fill="${t(color)}"`,
    face: `fill="${t("sticker-fill")}"`,
    shade: `fill="${t("sticker-ink")}" fill-opacity="0.16"`,
    ink: `fill="${t("sticker-ink")}"`,
  };
  const dashed = `fill="none" stroke="${t("sticker-ink")}" stroke-width="1.2" stroke-linecap="round" stroke-dasharray="1.6 1.6"`;
  const g = def.transform ? ` transform="${def.transform}"` : "";
  const parts = def.parts
    .map((p) => `<path d="${p.d}" ${p.dashed ? dashed : paint[p.paint]}/>`)
    .join("");
  // the shadow of a cursor flying at altitude 0.5, as the .pa-cast rule draws it
  const shadow = `<filter id="s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.2"/></filter>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX.size}" height="${BOX.size}" viewBox="${VIEWBOX}">` +
    `<defs><clipPath id="c"><path d="${def.outline}"${g}/></clipPath>${shadow}</defs>` +
    `<g transform="translate(6 8)" filter="url(#s)"><path${g} d="${def.outline}" fill="${t("sticker-shadow")}"/></g>` +
    `<g clip-path="url(#c)"><g${g}>${parts}</g></g>` +
    `<g${g}><path d="${def.outline}" fill="none" stroke="${t("sticker-ink")}" stroke-width="${parseFloat(t("line-ink"))}" stroke-linejoin="round"/></g>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${-BOX.x} ${-BOX.y}, default`;
}
