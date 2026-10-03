"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

import { useSelf } from "@liveblocks/react";

import { BillContent, useMyShare } from "@/components/multiplayer/split-bill";
import { memberColor } from "@/lib/liveblocks/types";
import { useMemberColor, usePlanLegs } from "@/lib/trip/plan";

// The plan, minimised: the trip as a tag, like the globe's place tags, tucked under the nav bar's right end. It says
// where the trip runs, how many legs and when, with your share on the bill's button and one to expand the plan again.
// It can be dragged anywhere and stays there; the bill opens down from under it.

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
/** "17–23 Oct", "30 Sep – 2 Oct", or one day. */
function span(first: string, last: string) {
  const a = DAY.formatToParts(new Date(`${first}T00:00:00Z`));
  const b = DAY.format(new Date(`${last}T00:00:00Z`));
  if (first === last) return b;
  const month = (parts: Intl.DateTimeFormatPart[]) => parts.find((p) => p.type === "month")?.value;
  return month(a) === month(DAY.formatToParts(new Date(`${last}T00:00:00Z`))) ? `${a.find((p) => p.type === "day")?.value}–${b}` : `${DAY.format(new Date(`${first}T00:00:00Z`))} – ${b}`;
}

/** Keep at least this far from the screen's edges. */
const EDGE = 16;
/** Pointer travel before a press on the dock becomes a drag rather than a click. */
const SLOP = 4;

export type DockSpot = { x: number; y: number } | null;

export function TripDock({
  spot,
  onMove,
  bill,
  onExpand,
}: {
  /** Where it was dragged to, top-left in its frame; null tucks it under the nav bar. */
  spot: DockSpot;
  onMove: (spot: DockSpot) => void;
  bill: { open: boolean; set: (open: boolean) => void };
  onExpand: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const me = useSelf((self) => self.id);
  const color = memberColor(useMemberColor(me, 1));
  const legs = usePlanLegs();
  const share = useMyShare();
  // under the nav bar until it's dragged; measured, since the bar's height follows the screen
  const [frame, setFrame] = useState({ navBottom: 72, width: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const box = root.current?.offsetParent?.getBoundingClientRect();
      const nav = document.querySelector(".pn-bar")?.getBoundingClientRect();
      if (box) setFrame({ navBottom: nav ? nav.bottom - box.top : 72, width: box.width });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const el = root.current;
    const frame = el?.offsetParent?.getBoundingClientRect();
    if (!el || !frame || event.button !== 0) return;
    const box = el.getBoundingClientRect();
    const from = { x: event.clientX, y: event.clientY };
    const start = { x: box.left - frame.left, y: box.top - frame.top };
    const handle = event.currentTarget;
    dragged.current = false;
    const move = (e: globalThis.PointerEvent) => {
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      if (!dragged.current && Math.hypot(dx, dy) < SLOP) return;
      if (!dragged.current) {
        dragged.current = true;
        // best effort: a pointer that's already gone can't be captured, and the drag works without it
        try {
          handle.setPointerCapture(e.pointerId);
        } catch {}
        handle.dataset.dragging = "";
      }
      const x = Math.min(Math.max(start.x + dx, EDGE), frame.width - box.width - EDGE);
      const y = Math.min(Math.max(start.y + dy, EDGE), frame.height - box.height - EDGE);
      onMove({ x, y });
    };
    // on the window: until the drag starts the pointer isn't captured, and it soon leaves the small dock
    const end = () => {
      delete handle.dataset.dragging;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  // first stop to last, by date, and the days it spans
  const ordered = [...(legs ?? [])].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const code = (stop: { code?: string | null; name: string }) => (stop.code && /^[A-Z]{3}$/.test(stop.code) ? stop.code : stop.name);
  const first = ordered[0];
  const last = ordered.at(-1);
  const route = first && last ? `${code(first.from)} → ${code(last.to)}` : null;
  const when = first && last ? `${ordered.length} leg${ordered.length === 1 ? "" : "s"} · ${span(first.date, last.date)}` : null;

  // the bill opens down from the dock, on whichever side keeps it on screen
  const leftHalf = spot ? spot.x < frame.width / 2 : false;
  const top = spot?.y ?? frame.navBottom + 8;
  const style: Record<string, string | number> = { top, "--dock-top": `${top}px`, ...(spot ? { left: spot.x } : { right: "var(--space-4)" }) };
  return (
    <div
      ref={root}
      className="tp-dock"
      style={style as CSSProperties}
      data-side={leftHalf ? "left" : "right"}
    >
      <div
        className="tp-dock-bar"
        title="Your trip. Drag to move"
        onPointerDown={drag}
        onClickCapture={(e) => {
          // the press that ended a drag isn't a click on a button
          if (dragged.current) {
            e.stopPropagation();
            e.preventDefault();
            dragged.current = false;
          }
        }}
      >
        <span className="tp-dock-live" style={{ background: color }} aria-hidden />
        {route ? <span className="tp-dock-route">{route}</span> : <span className="tp-dock-route">Your trip</span>}
        {when ? <span className="tp-dock-meta">{when}</span> : null}
        <span className="tp-dock-rule" aria-hidden />
        <button
          type="button"
          className="tp-dock-btn"
          aria-label={share ? `Split, your share ${share}` : "Split"}
          title="Split"
          aria-expanded={bill.open}
          aria-controls="dock-bill"
          onClick={() => bill.set(!bill.open)}
        >
          <svg width={13} height={13} viewBox="0 0 16 16" aria-hidden>
            <path d="M3.5 1.5h9v13l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1z" />
            <path d="M6 5h4M6 8h4M6 11h2" />
          </svg>
          {share ? <span>{share}</span> : null}
        </button>
        <button type="button" className="tp-dock-btn" aria-label="Expand your trip" title="Expand" onClick={onExpand}>
          <svg width={12} height={12} viewBox="0 0 14 14" aria-hidden>
            <path d="M8.5 1.5h4v4M12.5 1.5 8 6M5.5 12.5h-4v-4M1.5 12.5 6 8" />
          </svg>
        </button>
      </div>
      {bill.open ? (
        <section id="dock-bill" aria-label="Split" className="ts pa-cast tp-dock-bill">
          <BillContent />
        </section>
      ) : null}
    </div>
  );
}
