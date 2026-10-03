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
  /** Folded to the mode's glyph and the fare from the start. On the globe, `useTagOnRoute` folds and unfolds it. */
  compact?: boolean;
  onClick?: () => void;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * A minimised trip: a small ticket on the route, styled by the kind of trip. Clicking it opens the trip again. On a
 * route too short on screen to hold it (zoomed out), `useTagOnRoute` folds it to its mode's glyph and the fare.
 */
export function TripTag({ mode, from, to, price, compact, onClick, className, style, ref, ...aria }: TripTagProps) {
  return (
    <button ref={ref} type="button" data-globe-follow className={cn("ts-chip", `ts-chip-${mode}`, className)} data-compact={compact ? "" : undefined} style={style} onClick={onClick} {...aria}>
      <span className="ts-chip-main">
        <Glyph kind={mode} sticker />
        <span className="ts-chip-route">
          {from} → {to}
        </span>
      </span>
      {price ? <span className="ts-chip-price">{price}</span> : null}
    </button>
  );
}

/** How much longer than the whole tag a route must be on screen for the tag to show its ends' names. */
const FOLD_MARGIN = 24;

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
    // the tag's whole width, read while it's whole: folded, it's measured against that
    let whole = 0;
    const place = () => {
      const el = tag.current;
      const p = g.routePoint({ lat: fLat, lng: fLng }, { lat: tLat, lng: tLng });
      if (!el) return;
      // folded to glyph and fare when the route on screen is shorter than the whole tag, so it doesn't cover both
      // ends; it unfolds with some room to spare, so it doesn't flicker at the edge
      const a = g.project({ lat: fLat, lng: fLng });
      const b = g.project({ lat: tLat, lng: tLng });
      if (a && b) {
        const folded = el.dataset.compact !== undefined;
        if (!folded) whole = el.offsetWidth;
        const span = Math.hypot(b.x - a.x, b.y - a.y);
        if (!folded && span < whole + FOLD_MARGIN) el.dataset.compact = "";
        else if (folded && span > whole + FOLD_MARGIN * 2) delete el.dataset.compact;
      }
      el.style.visibility = p?.visible ? "visible" : "hidden";
      if (p) el.style.transform = `translate(${Math.round(p.x - el.offsetWidth / 2)}px, ${Math.round(p.y - el.offsetHeight / 2)}px) rotate(-1.2deg)`;
    };
    place();
    return g.onFrame(place);
  }, [globe, fLat, fLng, tLat, tLng]);
  return tag;
}
