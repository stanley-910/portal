import type { CSSProperties } from "react";

import { memberColor } from "@/components/paper-atlas";

// How to draw a trip, always in the bottom-left corner of the home globe, like a game's control hints: two small pixel
// mice, the left one's left button held down in your cursor colour (Create a trip), the right one's right (Add a
// stop). Hidden on touch screens, which have no right click.

// the mouse in CSS px, 13 × 18 with a 1px outline: the outline, the two buttons and the body below the divider
const W = 13;
const H = 18;
const OUTLINE = [
  [1, 0, 11, 1],
  [0, 1, 1, 16],
  [12, 1, 1, 16],
  [1, 17, 11, 1],
  [6, 1, 1, 6],
  [1, 7, 11, 1],
] as const;
const LEFT = [1, 1, 5, 6] as const;
const RIGHT = [7, 1, 5, 6] as const;
const BODY = [1, 8, 11, 9] as const;

function Mouse({ press }: { press: "left" | "right" }) {
  const rect = ([x, y, w, h]: readonly number[], className: string) => (
    <rect className={className} x={x} y={y} width={w} height={h} />
  );
  return (
    <svg className="ch-mouse" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden shapeRendering="crispEdges">
      {rect(BODY, "ch-body")}
      {rect(LEFT, press === "left" ? "ch-key ch-pressed" : "ch-key")}
      {rect(RIGHT, press === "right" ? "ch-key ch-pressed" : "ch-key")}
      {OUTLINE.map((r, i) => (
        <rect key={i} className="ch-ink" x={r[0]} y={r[1]} width={r[2]} height={r[3]} />
      ))}
    </svg>
  );
}

/** The click legend in the corner. `color` is your cursor's colour slot. */
export function ClickHint({ color }: { color: number }) {
  return (
    <div className="ch" role="note" aria-label="Click to create a trip, right-click to add a stop" style={{ "--member": `var(--${memberColor(color)})` } as CSSProperties}>
      <p className="ch-row">
        <Mouse press="left" />
        <span>Create a trip</span>
      </p>
      <p className="ch-row">
        <Mouse press="right" />
        <span>Add a stop</span>
      </p>
    </div>
  );
}
