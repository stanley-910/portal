"use client";

import { shallow, useOther, useOthers, useRoom } from "@liveblocks/react";
import { useEffect, useRef, type CSSProperties, type RefObject } from "react";

import { memberColor as paperMemberColor } from "@/components/paper-atlas";
import type { RemoteFlight, TripGlobeHandle } from "@/components/trip-globe";

/**
 * Everyone else's trip on the globe (M14 step 2): the globe draws their plane, route and pins; this adds their name
 * label beside the plane while it flies. Flights go straight from presence to the globe engine, and labels are positioned after
 * every frame, so a moving plane never re-renders React. React only re-renders when someone takes off or stops.
 */
export function RemotePlanes({ globe }: { globe: RefObject<TripGlobeHandle | null> }) {
  const room = useRoom();
  // only while in the air: once they land, their cursor and its label come back
  const flying = useOthers(
    (list) => list.filter((o) => o.presence.flight && !o.presence.flight.landed).map((o) => o.connectionId),
    shallow,
  );
  const els = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    const handle = globe.current;
    if (!handle) return;
    const push = () => {
      const flights: RemoteFlight[] = [];
      for (const o of room.getOthers()) if (o.presence.flight) flights.push({ id: String(o.connectionId), ...o.presence.flight });
      handle.setRemoteFlights(flights);
    };
    push();
    const unsubscribe = room.subscribe("others", push);
    const stopFrames = handle.onFrame(() => {
      for (const [id, el] of els.current) {
        const p = handle.remotePlane(String(id));
        if (p) el.style.transform = `translate(${p.x}px, ${p.y}px)`;
        el.style.opacity = p ? "1" : "0";
      }
    });
    return () => {
      unsubscribe();
      stopFrames();
      handle.setRemoteFlights([]);
    };
  }, [globe, room]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {flying.map((id) => (
        <PlaneLabel
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

/** The member's name beside their plane, in the cursor's name-label style (DESIGN.md, Cursors and members). */
function PlaneLabel({ connectionId, ref }: { connectionId: number; ref: (el: HTMLElement | null) => void }) {
  const info = useOther(connectionId, (o) => o.info);
  // the room numbers colours from 1; the design system's slots count from 0
  const style = { "--member": `var(--${paperMemberColor(info.color - 1)})` } as CSSProperties;
  return (
    <div ref={ref} className="absolute top-0 left-0 opacity-0 will-change-transform" style={style}>
      <span className="pa-cursor-name" style={{ top: -36, left: 14 }}>
        {info.name}
      </span>
    </div>
  );
}
