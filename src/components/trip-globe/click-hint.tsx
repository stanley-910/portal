"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { memberColor } from "@/components/paper-atlas";

// How to draw a trip, shown once each time the page loads: a label beside the pointer, in the style of a member's
// cursor label, with two pixel mice, plain until a button presses and colours in your cursor colour. One presses its left button (Create a trip), then the other
// its right (Add a stop), each with a little burst of dashes off the top. It follows the pointer for a few seconds and
// goes at the first click or right click. Mouse pointers only, since a touch screen has no right click.

/** How long it stays when nobody clicks, in ms. Matches the fade in click-hint's CSS. */
const SHOWN_MS = 4600;
const GONE_MS = 180;
/** Where it sits from the pointer's tip, in px: below and to the right, clear of the cursor sticker and the place name the globe prints beside it. */
const OFFSET = { x: 18, y: 34 };

// the mouse, 7 × 10 cells: its outline, the two buttons and the body below the divider
const CELL = 3;
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
  // the burst rises off the pressed button: three short dashes fanning up
  const cx = (press === "left" ? 2 : 5) * CELL;
  const pad = CELL * 3;
  return (
    <svg className="ch-mouse" width={7 * CELL + 2 * pad} height={10 * CELL + 8} viewBox={`${-pad} -8 ${7 * CELL + 2 * pad} ${10 * CELL + 8}`} aria-hidden shapeRendering="crispEdges">
      {rect(BODY, "ch-body")}
      {rect(LEFT, press === "left" ? "ch-key ch-pressed" : "ch-key")}
      {rect(RIGHT, press === "right" ? "ch-key ch-pressed" : "ch-key")}
      {OUTLINE.map((r, i) => (
        <rect key={i} className="ch-ink" x={r[0] * CELL} y={r[1] * CELL} width={r[2] * CELL} height={r[3] * CELL} />
      ))}
      <g className="ch-burst">
        <rect className="ch-ink" x={cx - CELL / 2} y={-7} width={CELL} height={4} />
        <rect className="ch-ink" x={cx - CELL * 2.5} y={-5} width={CELL} height={CELL} />
        <rect className="ch-ink" x={cx + CELL * 1.5} y={-5} width={CELL} height={CELL} />
      </g>
    </svg>
  );
}

/** The first-run hint by the pointer. `color` is your cursor's colour slot. */
export function ClickHint({ color }: { color: number }) {
  const [state, setState] = useState<"waiting" | "shown" | "going" | "gone">("waiting");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // a touch screen gets no hint: it has no right click
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const move = (e: PointerEvent) => {
      if (!fine || e.pointerType !== "mouse") return;
      const el = box.current;
      if (el) el.style.transform = `translate(${e.clientX + OFFSET.x}px, ${e.clientY + OFFSET.y}px)`;
      setState((s) => (s === "waiting" ? "shown" : s));
    };
    // any click or right click means they've got it
    const press = () => setState((s) => (s === "gone" ? s : "going"));
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", press, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", press, true);
    };
  }, []);

  useEffect(() => {
    if (state !== "shown" && state !== "going") return;
    const t = window.setTimeout(() => setState("gone"), state === "going" ? GONE_MS : SHOWN_MS);
    return () => window.clearTimeout(t);
  }, [state]);

  if (state === "gone") return null;
  return (
    <div
      ref={box}
      className="ch"
      data-state={state}
      role="note"
      aria-label="Click to create a trip, right-click to add a stop"
      style={{ "--member": `var(--${memberColor(color)})` } as CSSProperties}
    >
      <div className="ch-card">
        <p className="ch-row">
          <Mouse press="left" />
          <span>Create a trip</span>
        </p>
        <p className="ch-row" data-second>
          <Mouse press="right" />
          <span>Add a stop</span>
        </p>
      </div>
    </div>
  );
}
