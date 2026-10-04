"use client";

import type { PointerEvent } from "react";

import type { PipEdge } from "@/components/agent/pip-frame";

const EDGES: PipEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/** The handles Pip's panel is resized by, like a window's: each edge and corner, unseen until the pointer finds them. */
export function PipEdges({ onSize }: { onSize: (edge: PipEdge) => (e: PointerEvent<HTMLElement>) => void }) {
  return (
    <>
      {EDGES.map((edge) => (
        <span key={edge} className="pip-edge" data-edge={edge} aria-hidden onPointerDown={onSize(edge)} />
      ))}
    </>
  );
}
