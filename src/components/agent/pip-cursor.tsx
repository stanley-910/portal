"use client";

import { useOthers, useRoom } from "@liveblocks/react";
import { useEffect, useRef, type RefObject } from "react";

import { PipSprite } from "@/components/agent/pip-sprite";
import type { TripGlobeHandle } from "@/components/trip-globe";
import { AGENT_ID, AGENT_NAME } from "@/lib/agent/types";

// Pip's cursor (handoff §4): a pixel arrow that eases toward where Pip is working, with what it's doing beside it.
// Its position comes from the presence the server sets for Pip; it's written to the DOM after every globe frame.

const ARROW = [
  "X..........",
  "XX.........",
  "X#X........",
  "X##X.......",
  "X###X......",
  "X####X.....",
  "X#####X....",
  "X######X...",
  "X#######X..",
  "X########X.",
  "X#####XXXXX",
  "X##X##X....",
  "X#X.X##X...",
  "XX..X##X...",
  ".....X##X..",
  ".....X##X..",
  "......XX...",
];
const CELL = 2;
/** Eases this share of the way to its target each frame. */
const EASE = 0.07;

export function PipCursor({ globe }: { globe: RefObject<TripGlobeHandle | null> }) {
  const room = useRoom();
  const activity = useOthers((list) => list.find((o) => o.id === AGENT_ID)?.presence.activity ?? null);
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = globe.current;
    if (!handle) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let at: { x: number; y: number } | null = null;
    return handle.onFrame(() => {
      const node = el.current;
      if (!node) return;
      const pip = room.getOthers().find((o) => o.id === AGENT_ID);
      const target = pip?.presence.cursor ? handle.project(pip.presence.cursor) : null;
      if (!target || !target.visible) {
        node.style.opacity = "0";
        return;
      }
      at = !at || still ? { x: target.x, y: target.y } : { x: at.x + (target.x - at.x) * EASE, y: at.y + (target.y - at.y) * EASE };
      node.style.transform = `translate(${Math.round(at.x / 2) * 2}px, ${Math.round(at.y / 2) * 2}px)`;
      node.style.opacity = "1";
    });
  }, [globe, room]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div ref={el} className="pip-cursor" style={{ opacity: 0 }}>
        <svg className="pip-cursor-arrow" width={11 * CELL} height={17 * CELL} viewBox="0 0 11 17" shapeRendering="crispEdges">
          {ARROW.flatMap((row, y) =>
            [...row].map((c, x) =>
              c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={c === "X" ? "var(--sticker-ink)" : "var(--star-light)"} />,
            ),
          )}
        </svg>
        <span className="pip-cursor-label">
          <PipSprite size={20} mood={activity ? "think" : "idle"} />
          {AGENT_NAME}
          {activity ? <span>· {activity}</span> : null}
        </span>
      </div>
    </div>
  );
}
