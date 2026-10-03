import { useEffect, useRef, type CSSProperties, type Ref, type RefObject } from "react";

import type { LatLng, TripGlobeHandle } from "@/components/trip-globe";

import { cn } from "@/lib/utils";
import type { Mode } from "@/lib/transport/types";

import { Glyph } from "./glyphs";

export interface TripTagProps {
  /** The kind of trip, which sets the ticket: boarding pass, rail ticket, ferry pass or bus ticket. */
  mode: Mode;
  /** Short names for each end: an airport code, or the city. */
  from: string;
  to: string;
  /** The formatted fare, printed on the tear-off stub. */
  price?: string | null;
  onClick?: () => void;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLButtonElement>;
}

/** A minimised trip: a small ticket on the route, styled by the kind of trip. Clicking it opens the trip again. */
export function TripTag({ mode, from, to, price, onClick, className, style, ref, ...aria }: TripTagProps) {
  return (
    <button ref={ref} type="button" data-globe-follow className={cn("ts-chip", `ts-chip-${mode}`, className)} style={style} onClick={onClick} {...aria}>
      <span className="ts-chip-main">
        <Glyph kind={mode} sticker />
        {from} → {to}
      </span>
      {price ? <span className="ts-chip-price">{price}</span> : null}
    </button>
  );
}

/**
 * Keeps a tag on a route: centred on the peak of the arc the globe draws from `from` to `to`, tilted like the ticket,
 * hidden while the globe hides that point. Returns the ref for the tag.
 */
export function useTagOnRoute(globe: RefObject<TripGlobeHandle | null>, from: LatLng, to: LatLng) {
  const tag = useRef<HTMLButtonElement>(null);
  const { lat: fLat, lng: fLng } = from;
  const { lat: tLat, lng: tLng } = to;
  useEffect(() => {
    const g = globe.current;
    if (!g) return;
    const place = () => {
      const el = tag.current;
      const p = g.routePoint({ lat: fLat, lng: fLng }, { lat: tLat, lng: tLng });
      if (!el) return;
      el.style.visibility = p?.visible ? "visible" : "hidden";
      if (p) el.style.transform = `translate(${Math.round(p.x - el.offsetWidth / 2)}px, ${Math.round(p.y - el.offsetHeight / 2)}px) rotate(-1.2deg)`;
    };
    place();
    return g.onFrame(place);
  }, [globe, fLat, fLng, tLat, tLng]);
  return tag;
}
