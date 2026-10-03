"use client";

import { useSelf } from "@liveblocks/react";
import { useEffect, useMemo, useRef, type RefObject } from "react";

import type { GlobePin, TripGlobeHandle } from "@/components/trip-globe";
import { usePlanLegs, usePlanMembers, type PlanLeg } from "@/lib/trip/plan";

type Arrival = { stop: PlanLeg["to"]; riders: string[] };

/** Each stop someone travels to, with everyone arriving there, in the order the legs were drawn. */
export function arrivals(legs: Pick<PlanLeg, "to" | "riders">[]): Arrival[] {
  const byStop = new Map<string, Arrival>();
  for (const leg of legs) {
    let arrival = byStop.get(leg.to.id);
    if (!arrival) byStop.set(leg.to.id, (arrival = { stop: leg.to, riders: [] }));
    for (const rider of leg.riders) if (!arrival.riders.includes(rider)) arrival.riders.push(rider);
  }
  return [...byStop.values()].filter((arrival) => arrival.riders.length > 0);
}

/** One pin per rider at each stop they arrive at, in their member colour (the room numbers colours from 1). */
export function riderPins(list: Arrival[], members: Record<string, { color: number } | undefined>): GlobePin[] {
  return list.flatMap(({ stop, riders }) =>
    riders.map((rider) => {
      const color = members[rider]?.color;
      return { key: `${stop.id}:${rider}`, stop: stop.id, at: { lat: stop.lat, lng: stop.lng }, color: color ? color - 1 : null };
    }),
  );
}

const names = new Intl.ListFormat("en", { type: "conjunction" });

/**
 * A pin dropped at each stop the trip goes to for every rider arriving there, in their member colour; the globe
 * draws them. Pointing at a stop's pins names its riders, and clicking them opens the trip plan.
 */
export function RiderPins({ globe, onOpen }: { globe: RefObject<TripGlobeHandle | null>; onOpen: () => void }) {
  const legs = usePlanLegs();
  const members = usePlanMembers();
  const me = useSelf((self) => self.id);
  const list = useMemo(() => (legs ? arrivals(legs) : []), [legs]);
  const pins = useMemo(() => (members ? riderPins(list, members) : []), [list, members]);

  // setting the same pins again changes nothing, so a new list that only looks different is harmless
  useEffect(() => {
    globe.current?.setPins(pins);
  }, [globe, pins]);
  useEffect(() => () => globe.current?.setPins([]), [globe]);

  if (!members || !list.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 isolate overflow-hidden">
      {list.map(({ stop, riders }) => {
        const said = names.format(riders.map((id) => (id === me ? "you" : members[id]?.name ?? "someone")));
        return <PinTarget key={stop.id} globe={globe} stop={stop} who={said.charAt(0).toUpperCase() + said.slice(1)} onOpen={onOpen} />;
      })}
    </div>
  );
}

/** An unseen button over a stop's pins: their riders' names on a label while pointed at, the plan on a click. */
function PinTarget({ globe, stop, who, onOpen }: { globe: RefObject<TripGlobeHandle | null>; stop: Arrival["stop"]; who: string; onOpen: () => void }) {
  const target = useRef<HTMLButtonElement>(null);
  const id = stop.id;
  useEffect(() => {
    const g = globe.current;
    if (!g) return;
    const place = () => {
      const el = target.current;
      const spot = g.pinSpot(id);
      if (!el) return;
      el.style.visibility = spot ? "visible" : "hidden";
      if (!spot) return;
      el.style.width = el.style.height = `${Math.round(spot.r * 2)}px`;
      // near the right edge, the names go on the left
      el.toggleAttribute("data-flip", spot.x > (el.offsetParent?.clientWidth ?? window.innerWidth) - 240);
      el.style.transform = `translate(${Math.round(spot.x - spot.r)}px, ${Math.round(spot.y - spot.r)}px)`;
    };
    place();
    return g.onFrame(place);
  }, [globe, id]);
  return (
    <button
      ref={target}
      type="button"
      className="rp"
      data-globe-follow
      style={{ visibility: "hidden" }}
      aria-label={`${who} to ${stop.name}. Open the plan`}
      onClick={onOpen}
    >
      <span className="rp-name" aria-hidden>
        {who}
      </span>
    </button>
  );
}
