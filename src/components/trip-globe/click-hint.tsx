import type { CSSProperties } from "react";

import { memberColor } from "@/components/paper-atlas";

// How to draw a trip, always in the bottom-left corner of the home globe, like a game's control hints: two small pixel
// mice, the left one's left button held down in your cursor colour (Create a trip), the right one's right (Add a
// stop). Hidden on touch screens, which have no right click.

// the mouse, 7 × 10 cells: its outline, the two buttons and the body below the divider
const CELL = 2;
const OUTLINE = [
  [1, 0, 5, 1],
  [0, 1, 1, 8],
  [6, 1, 1, 8],
  [1, 9, 5, 1],
  [3, 1, 1, 3],
  [1, 4, 5, 1],
] as const;
const LEFT = [1, 1, 2, 3] as const;
const RIGHT = [4, 1, 2, 3] as const;
const BODY = [1, 5, 5, 4] as const;

function Mouse({ press }: { press: "left" | "right" }) {
  const rect = ([x, y, w, h]: readonly number[], className: string) => (
    <rect className={className} x={x * CELL} y={y * CELL} width={w * CELL} height={h * CELL} />
  );
  return (
    <svg className="ch-mouse" width={7 * CELL} height={10 * CELL} viewBox={`0 0 ${7 * CELL} ${10 * CELL}`} aria-hidden shapeRendering="crispEdges">
      {rect(BODY, "ch-body")}
      {rect(LEFT, press === "left" ? "ch-key ch-pressed" : "ch-key")}
      {rect(RIGHT, press === "right" ? "ch-key ch-pressed" : "ch-key")}
      {OUTLINE.map((r, i) => (
        <rect key={i} className="ch-ink" x={r[0] * CELL} y={r[1] * CELL} width={r[2] * CELL} height={r[3] * CELL} />
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
