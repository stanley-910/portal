"use client";

import { useSelf } from "@liveblocks/react";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from "react";

import type { GlobePin, TripGlobeHandle } from "@/components/trip-globe";
import { usePlanActions, usePlanLegs, usePlanMembers, type EditResult, type PlanLeg } from "@/lib/trip/plan";
import { stopFromPoint } from "@/lib/trip/stops";

/** Pointer travel before a press on a stop's pins becomes a drag rather than a click. */
const SLOP = 5;
/** Why a dropped stop didn't move, said where it was dropped. */
const REFUSED: Record<Exclude<EditResult, "ok">, string> = {
  gone: "That stop was removed.",
  locked: "A leg there is being booked, so it can't move.",
  replaced: "That stop changed. Try again.",
};

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
 * draws them. Pointing at a stop's pins names its riders, clicking them opens the trip plan, and dragging them moves
 * the stop for everyone: its legs search again from where it's dropped.
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

/**
 * An unseen button over a stop's pins: their riders' names on a label while pointed at, the plan on a click. Dragged,
 * the globe lifts the stop's pins and carries them, routes and all, with the place they'd land at on a tag beside the
 * pointer; dropping them moves the stop there, and Escape puts them back.
 */
function PinTarget({
  globe,
  stop,
  who,
  onOpen,
}: {
  globe: RefObject<TripGlobeHandle | null>;
  stop: Arrival["stop"];
  who: string;
  onOpen: () => void;
}) {
  const target = useRef<HTMLButtonElement>(null);
  const dragged = useRef(false);
  const { moveStop } = usePlanActions();
  // while dragging: where the pointer is in the overlay, and the place under it
  const [drag, setDrag] = useState<{ x: number; y: number; name: string | null } | null>(null);
  const [notice, setNotice] = useState<{ x: number; y: number; text: string } | null>(null);
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
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const press = (event: PointerEvent<HTMLButtonElement>) => {
    const g = globe.current;
    const box = target.current?.offsetParent?.getBoundingClientRect();
    if (!g || !box || event.button !== 0) return;
    const from = { x: event.clientX, y: event.clientY };
    const handle = event.currentTarget;
    const pointer = event.pointerId;
    dragged.current = false;
    const at = (e: globalThis.PointerEvent) => ({ x: e.clientX - box.left, y: e.clientY - box.top });
    const move = (e: globalThis.PointerEvent) => {
      if (!dragged.current && Math.hypot(e.clientX - from.x, e.clientY - from.y) < SLOP) return;
      if (!dragged.current) {
        dragged.current = true;
        // best effort: a pointer that's already gone can't be captured, and the drag works without it
        try {
          handle.setPointerCapture(pointer);
        } catch {}
      }
      const p = at(e);
      // the pins hang with their heads under the pointer; the place is the ground below them
      const place = g.liftStop(id, p.x, p.y);
      setDrag({ ...p, name: place?.name ?? null });
    };
    const stopListening = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape);
      setDrag(null);
    };
    const drop = (e: globalThis.PointerEvent) => {
      stopListening();
      if (!dragged.current) return;
      const p = at(e);
      const place = g.landing(id);
      // off the globe, the pins go back
      if (!place) return g.dropStop(id, null);
      const result = moveStop(id, stopFromPoint(place.at, place.hub));
      g.dropStop(id, result === "ok" ? place.at : null);
      if (result !== "ok") setNotice({ ...p, text: REFUSED[result] });
    };
    const cancel = () => {
      stopListening();
      g.dropStop(id, null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape);
  };

  return (
    <>
      <button
        ref={target}
        type="button"
        className="rp"
        data-globe-follow
        data-dragging={drag ? "" : undefined}
        style={{ visibility: "hidden" }}
        aria-label={`${who} to ${stop.name}. Open the plan, or drag to move the stop`}
        onPointerDown={press}
        onClick={() => {
          // the press that ended a drag isn't a click
          if (dragged.current) dragged.current = false;
          else onOpen();
        }}
      >
        <span className="rp-name" aria-hidden>
          {who}
        </span>
      </button>
      {drag ? (
        <div className="rp-ghost" style={{ transform: `translate(${Math.round(drag.x)}px, ${Math.round(drag.y)}px)` }} aria-hidden>
          <span className="rp-ghost-name">{drag.name ? `Move ${stop.name} to ${drag.name}` : `Move ${stop.name}`}</span>
        </div>
      ) : null}
      {notice ? (
        <p className="rp-ghost rp-ghost-name rp-notice" role="status" style={{ transform: `translate(${Math.round(notice.x)}px, ${Math.round(notice.y)}px)` }}>
          {notice.text}
        </p>
      ) : null}
    </>
  );
}
