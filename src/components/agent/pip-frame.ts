"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

// Pip's panel, moved and sized by hand like a window: dragged by its header, resized from any edge or corner (the grip
// in the bottom-right corner shows where). Until either is touched it sits where its CSS puts it; after, it keeps its
// place and size while the page is open, kept inside the screen as the window changes.

type Frame = { x: number; y: number; w: number; h: number };

/** Which edges a resize moves: n, s, e, w, or a corner (ne, nw, se, sw). */
export type PipEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Keep at least this far inside the screen. */
const EDGE = 8;
/** The smallest it gets: room for the header, a reply and the composer. */
const MIN_W = 300;
const MIN_H = 280;

const fit = (f: Frame, W: number, H: number): Frame => {
  const w = Math.min(Math.max(f.w, MIN_W), Math.max(MIN_W, W - 2 * EDGE));
  const h = Math.min(Math.max(f.h, MIN_H), Math.max(MIN_H, H - 2 * EDGE));
  return { w, h, x: Math.min(Math.max(f.x, EDGE), Math.max(EDGE, W - w - EDGE)), y: Math.min(Math.max(f.y, EDGE), Math.max(EDGE, H - h - EDGE)) };
};

export function usePipFrame() {
  const panel = useRef<HTMLElement>(null);
  const [frame, setFrame] = useState<Frame | null>(null);

  // the window changing size keeps it on screen
  useEffect(() => {
    if (!frame) return;
    const refit = () => {
      const box = panel.current?.offsetParent as HTMLElement | null;
      if (box) setFrame((f) => (f ? fit(f, box.clientWidth, box.clientHeight) : f));
    };
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, [frame]);

  const start = (event: PointerEvent<HTMLElement>, kind: "move" | PipEdge) => {
    // the header's own buttons (close) are theirs, not drags
    if (event.button !== 0 || (kind === "move" && (event.target as Element).closest("button, a, input, textarea"))) return;
    const el = panel.current;
    const box = el?.offsetParent as HTMLElement | null;
    if (!el || !box) return;
    event.preventDefault();
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const begin: Frame = { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height };
    const from = { x: event.clientX, y: event.clientY };
    const handle = event.currentTarget;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {}
    handle.dataset.dragging = "";
    const move = (e: globalThis.PointerEvent) => {
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      if (kind === "move") return setFrame(fit({ ...begin, x: begin.x + dx, y: begin.y + dy }, box.clientWidth, box.clientHeight));
      // the edges it's dragged by move; the opposite ones stay put, down to its smallest and inside the screen
      const right = begin.x + begin.w;
      const bottom = begin.y + begin.h;
      let { x, y, w, h } = begin;
      if (kind.includes("e")) w = Math.min(Math.max(MIN_W, begin.w + dx), box.clientWidth - EDGE - begin.x);
      if (kind.includes("s")) h = Math.min(Math.max(MIN_H, begin.h + dy), box.clientHeight - EDGE - begin.y);
      if (kind.includes("w")) {
        x = Math.min(Math.max(EDGE, begin.x + dx), right - MIN_W);
        w = right - x;
      }
      if (kind.includes("n")) {
        y = Math.min(Math.max(EDGE, begin.y + dy), bottom - MIN_H);
        h = bottom - y;
      }
      setFrame(fit({ x, y, w, h }, box.clientWidth, box.clientHeight));
    };
    const end = () => {
      delete handle.dataset.dragging;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const style: CSSProperties | undefined = frame
    ? { left: frame.x, top: frame.y, width: frame.w, height: frame.h, right: "auto", bottom: "auto", maxHeight: "none" }
    : undefined;
  return {
    panel,
    style,
    /** Set once it's been moved or sized by hand. */
    placed: !!frame,
    onMove: (e: PointerEvent<HTMLElement>) => start(e, "move"),
    /** Resizes from the given edge or corner. */
    onSize: (edge: PipEdge) => (e: PointerEvent<HTMLElement>) => start(e, edge),
  };
}
