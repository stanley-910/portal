import type { CSSProperties, Ref } from "react";

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
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLButtonElement>;
}

/** A minimised trip: a small ticket on the route, styled by the kind of trip. Clicking it opens the trip again. */
export function TripTag({ mode, from, to, price, onClick, className, style, ref, ...aria }: TripTagProps) {
  return (
    <button ref={ref} type="button" className={cn("ts-chip", `ts-chip-${mode}`, className)} style={style} onClick={onClick} {...aria}>
      <span className="ts-chip-main">
        <Glyph kind={mode} sticker />
        {from} → {to}
      </span>
      {price ? <span className="ts-chip-price">{price}</span> : null}
    </button>
  );
}
