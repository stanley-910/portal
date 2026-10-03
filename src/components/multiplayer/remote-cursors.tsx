"use client";

import { shallow, useOther, useOthers, useRoom } from "@liveblocks/react";
import { useEffect, useRef, type RefObject } from "react";

import { Cursor as StickerCursor, memberColor as paperMemberColor } from "@/components/paper-atlas";
import type { TripGlobeHandle } from "@/components/trip-globe";
import { AGENT_ID } from "@/lib/agent/types";
import { useMemberColor } from "@/lib/trip/plan";

/**
 * Everyone else's cursor, pinned to the place they point at. React renders one element per person and only
 * re-renders when someone joins or leaves. The globe moves each cursor steadily between presence updates, lays it on
 * the ground and draws its shadow, as it does the viewer's own; positions go straight to the DOM after every frame.
 */
export function RemoteCursors({ globe }: { globe: RefObject<TripGlobeHandle | null> }) {
  const room = useRoom();
  // Pip has its own pixel cursor (components/agent/pip-cursor)
  const ids = useOthers((list) => list.filter((o) => o.id !== AGENT_ID).map((o) => o.connectionId), shallow);
  const els = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    const handle = globe.current;
    if (!handle) return;
    const push = () =>
      handle.setRemoteCursors(
        room.getOthers().filter((o) => o.id !== AGENT_ID).map((o) => {
          // while their plane is in the air it is their pointer, so the plane's label stands in for the cursor
          const flying = o.presence.flight && !o.presence.flight.landed;
          return { id: String(o.connectionId), at: flying ? null : o.presence.cursor, shape: o.presence.shape };
        }),
      );
    push();
    const unsubscribe = room.subscribe("others", push);
    const stopFrames = handle.onFrame(() => {
      for (const [id, el] of els.current) {
        const c = handle.remoteCursor(String(id));
        el.style.opacity = c ? "1" : "0";
        if (!c) continue;
        el.style.transform = `translate(${c.x}px, ${c.y}px)`;
        // flat on the ground under it, like the viewer's own pointer; the name label stays upright
        const sticker = el.querySelector<SVGElement>(".pa-cursor-sticker");
        if (sticker) sticker.style.transform = `matrix(${c.lie.join(",")},0,0)`;
      }
    });
    return () => {
      unsubscribe();
      stopFrames();
      handle.setRemoteCursors([]);
    };
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
  const who = useOther(connectionId, (o) => ({ id: o.id, name: o.info.name, color: o.info.color, shape: o.presence.shape ?? "arrow" }), shallow);
  // the plan's colour, so one picked in the room shows at once; the room numbers colours from 1, slots from 0
  const color = useMemberColor(who.id, who.color);
  return (
    <div ref={ref} className="absolute top-0 left-0 opacity-0 transition-opacity duration-150 will-change-transform">
      {/* the globe draws its shadow */}
      {/* in the shape they picked */}
      <StickerCursor shape={who.shape} color={paperMemberColor(color - 1)} name={who.name} cast={false} />
    </div>
  );
}
