"use client";

import { shallow, useOther, useOthers, useRoom } from "@liveblocks/react";
import { useEffect, useRef, type RefObject } from "react";

import { Cursor as StickerCursor, memberColor as paperMemberColor } from "@/components/paper-atlas";
import type { TripGlobeHandle } from "@/components/trip-globe";
import { AGENT_ID } from "@/lib/agent/types";

/**
 * Everyone else's cursor, pinned to the place they point at. React renders one element per person and only
 * re-renders when someone joins or leaves; positions are written straight to the DOM after every globe frame, from
 * the room's latest presence, so moving cursors never re-render React.
 */
export function RemoteCursors({ globe }: { globe: RefObject<TripGlobeHandle | null> }) {
  const room = useRoom();
  // Pip has its own pixel cursor (components/agent/pip-cursor)
  const ids = useOthers((list) => list.filter((o) => o.id !== AGENT_ID).map((o) => o.connectionId), shallow);
  const els = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    const handle = globe.current;
    if (!handle) return;
    return handle.onFrame(() => {
      const shown = new Set<number>();
      for (const other of room.getOthers()) {
        const el = els.current.get(other.connectionId);
        // while their plane is in the air it is their pointer, so the plane's label stands in for the cursor
        const flying = other.presence.flight && !other.presence.flight.landed;
        const cursor = flying ? null : other.presence.cursor;
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
  // the room numbers colours from 1; the design system's slots count from 0
  return (
    <div ref={ref} className="absolute top-0 left-0 opacity-0 transition-opacity duration-150 will-change-transform">
      <StickerCursor color={paperMemberColor(info.color - 1)} name={info.name} />
    </div>
  );
}
