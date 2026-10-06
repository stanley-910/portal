"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

import { useSelf } from "@liveblocks/react";

import { BillContent, useMyShare } from "@/components/multiplayer/split-bill";
import { memberColor } from "@/lib/liveblocks/types";
import { useMemberColor, usePlanLegs } from "@/lib/trip/plan";

// The plan, minimised: the trip as a tag, like the globe's place tags, tucked under the nav bar's right end. It says
// where the trip runs, how many legs and when, with your share on the bill's button and one to expand the plan again.
// It can be dragged anywhere and stays there; the bill opens down from under it.

const DAY = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
/** "Oct 17–23", "Sep 30 – Oct 2", or one day: month first. */
function span(first: string, last: string) {
  const a = DAY.format(new Date(`${first}T00:00:00Z`));
  const b = DAY.formatToParts(new Date(`${last}T00:00:00Z`));
  if (first === last) return a;
  const month = (parts: Intl.DateTimeFormatPart[]) => parts.find((p) => p.type === "month")?.value;
  return month(DAY.formatToParts(new Date(`${first}T00:00:00Z`))) === month(b) ? `${a}–${b.find((p) => p.type === "day")?.value}` : `${a} – ${DAY.format(new Date(`${last}T00:00:00Z`))}`;
}

/** Keep at least this far from the screen's edges. */
const EDGE = 16;
/** px kept below an open bill's dock: the 80 px its max-height leaves under it, and room for a few of its rows. */
const BILL_ROOM = 80 + 160;
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
  const bars = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const me = useSelf((self) => self.id);
  const color = memberColor(useMemberColor(me, 1));
  const legs = usePlanLegs();
  const share = useMyShare();
  // under the nav bar until it's dragged; measured, since the bar's height follows the screen, and with the dock's own
  // size, so wherever it was dragged it's kept on screen as the window or the dock changes
  const [frame, setFrame] = useState({ navBottom: 72, width: 0, height: 0, w: 0, h: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const box = root.current?.offsetParent?.getBoundingClientRect();
      // the bar, not the bill that opens under it: the bill scrolls within the screen itself
      const bar = bars.current;
      const nav = document.querySelector(".pn-bar")?.getBoundingClientRect();
      if (bar && box) {
        const next = { navBottom: nav ? nav.bottom - box.top : 72, width: box.width, height: box.height, w: bar.offsetWidth, h: bar.offsetHeight };
        setFrame((f) => (Object.keys(next) as (keyof typeof next)[]).every((k) => f[k] === next[k]) ? f : next);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    const sized = new ResizeObserver(measure);
    if (bars.current) sized.observe(bars.current);
    return () => {
      window.removeEventListener("resize", measure);
      sized.disconnect();
    };
  }, []);
  // clear of the nav bar, which sits over it, and on screen, with room under it for the bill when that's open
  const keep = (x: number, y: number, w: number, h: number, width: number, height: number) => {
    const top = frame.navBottom + 8;
    const floor = Math.min(height - h - EDGE, bill.open ? height - BILL_ROOM : Infinity);
    return {
      x: Math.min(Math.max(x, EDGE), Math.max(EDGE, width - w - EDGE)),
      y: Math.min(Math.max(y, top), Math.max(top, floor)),
    };
  };

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
      onMove(keep(start.x + dx, start.y + dy, box.width, bars.current?.offsetHeight ?? box.height, frame.width, frame.height));
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

  const at = spot && frame.width ? keep(spot.x, spot.y, frame.w, frame.h, frame.width, frame.height) : spot;
  // the bill opens down from the dock, on whichever side keeps it on screen
  const leftHalf = at ? at.x < frame.width / 2 : false;
  const top = at?.y ?? frame.navBottom + 8;
  const style: Record<string, string | number> = { top, "--dock-top": `${top}px`, ...(at ? { left: at.x } : { right: "var(--space-4)" }) };
  return (
    <div
      ref={root}
      className="tp-dock"
      style={style as CSSProperties}
      data-side={leftHalf ? "left" : "right"}
    >
      <div
        ref={bars}
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
