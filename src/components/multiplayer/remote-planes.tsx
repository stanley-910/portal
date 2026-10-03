"use client";

import { shallow, useOther, useOthers, useRoom, useStorage } from "@liveblocks/react";
import { useEffect, useRef, type CSSProperties, type RefObject } from "react";

import { memberColor as paperMemberColor } from "@/components/paper-atlas";
import type { LatLng, RemoteFlight, TripGlobeHandle } from "@/components/trip-globe";

/**
 * Everyone else's trips on the globe and every stored leg: the globe draws each plane, route and
 * pins; this adds a member's name label beside their plane while it flies. Flights go straight from presence to the
 * globe engine, and labels are positioned after every frame, so a moving plane never re-renders React. React only
 * re-renders when someone takes off or stops, or the plan changes.
 *
 * `hideLegs` are the legs you just landed, which your own globe is still showing.
 */
export function RemotePlanes({ globe, hideLegs }: { globe: RefObject<TripGlobeHandle | null>; hideLegs: string[] }) {
  const room = useRoom();
  const legs = useStorage((root) => storedFlights(root), shallowFlights);
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
      const flights: RemoteFlight[] = (legs ?? []).filter((l) => !hideLegs.some((id) => l.id === `leg:${id}`));
      // a landed trip is stored as a leg straight away, so only trips still in the air come from presence
      for (const o of room.getOthers()) {
        const f = o.presence.flight;
        // the room numbers colours from 1; the design system's slots count from 0
        if (f && !f.landed) flights.push({ id: String(o.connectionId), ...f, color: o.info.color - 1 });
      }
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
  }, [globe, room, legs, hideLegs]);

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

type Plan = {
  readonly legs: { readonly [id: string]: { readonly from: string; readonly to: string; readonly createdBy: string } };
  readonly stops: { readonly [id: string]: LatLng };
  readonly members: { readonly [id: string]: { readonly color: number } };
};

/** Each stored leg as a landed flight: the plane parked at its end, facing along the route, in its drawer's colour. */
function storedFlights(root: Plan): RemoteFlight[] {
  const flights: RemoteFlight[] = [];
  for (const [id, leg] of Object.entries(root.legs)) {
    const from = root.stops[leg.from];
    const to = root.stops[leg.to];
    if (!from || !to) continue;
    const o = { lat: from.lat, lng: from.lng };
    const at = { lat: to.lat, lng: to.lng };
    // a hair past the end gives the heading; near enough on a great circle for a parked plane
    const ahead = { lat: at.lat + (at.lat - o.lat) * 0.01, lng: at.lng + (at.lng - o.lng) * 0.01 };
    const drawer = root.members[leg.createdBy];
    flights.push({ id: `leg:${id}`, origin: o, at, ahead, landed: true, color: drawer ? drawer.color - 1 : null });
  }
  return flights;
}

const shallowFlights = (a: RemoteFlight[] | null, b: RemoteFlight[] | null) => JSON.stringify(a) === JSON.stringify(b);
