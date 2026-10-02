"use client";

import { useOther, useOthersConnectionIds, useRoom } from "@liveblocks/react";
import { useEffect, useRef, type RefObject } from "react";

import type { TripGlobeHandle } from "@/components/trip-globe";
import { memberColor } from "@/lib/liveblocks/types";

/**
 * Everyone else's cursor, pinned to the place they point at (M14). React renders one element per person and only
 * re-renders when someone joins or leaves; positions are written straight to the DOM after every globe frame, from
 * the room's latest presence, so moving cursors never re-render React.
 */
export function RemoteCursors({ globe }: { globe: RefObject<TripGlobeHandle | null> }) {
  const room = useRoom();
  const ids = useOthersConnectionIds();
  const els = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    const handle = globe.current;
    if (!handle) return;
    return handle.onFrame(() => {
      const shown = new Set<number>();
      for (const other of room.getOthers()) {
        const el = els.current.get(other.connectionId);
        const cursor = other.presence.cursor;
        const p = el && cursor ? handle.project(cursor) : null;
        if (!el || !p || !p.visible) continue;
        el.style.transform = `translate(${p.x}px, ${p.y}px)`;
        el.style.opacity = "1";
        shown.add(other.connectionId);
      }
      for (const [id, el] of els.current) if (!shown.has(id)) el.style.opacity = "0";
    });
  }, [globe, room]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {ids.map((id) => (
        <Cursor
          key={id}
          connectionId={id}
          ref={(el) => {
            if (el) els.current.set(id, el);
            else els.current.delete(id);
          }}
        />
      ))}
    </div>
  );
}

function Cursor({ connectionId, ref }: { connectionId: number; ref: (el: HTMLElement | null) => void }) {
  const info = useOther(connectionId, (o) => o.info);
  const color = memberColor(info.color);
  return (
    <div ref={ref} className="absolute top-0 left-0 opacity-0 transition-opacity duration-150 will-change-transform">
      <svg width="18" height="18" viewBox="0 0 18 18" className="-translate-x-px -translate-y-px">
        <path
          d="M1 1 L16 7.5 L9 9 L7.5 16 Z"
          fill={color}
          stroke="var(--paper-raised)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="type-tag absolute top-4 left-4 rounded-tag px-(--space-2) whitespace-nowrap text-paper-raised shadow-tag"
        style={{ background: color }}
      >
        {info.name}
      </span>
    </div>
  );
}
