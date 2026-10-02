import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

import { RoundButton } from "./round-button";
import { Route } from "./route";

export interface Place {
  /** Airport code, three capitals: "HKG". */
  code: string;
  /** City name in its own spelling: "São Paulo". */
  city: string;
}

export interface TicketProps {
  from: Place;
  to: Place;
  /** Departure date as shown, e.g. "Sat 3 Oct" (set in capitals by the style). */
  date: string;
  /** Distance as shown, e.g. "9,624 km". */
  distance?: string;
  /** Route marches and the three dots bob while true. Default true. */
  searching?: boolean;
  /** Shows the round close button when given. */
  onClose?: () => void;
  /** Accessible name of the close button. Default "Cancel trip". */
  closeLabel?: string;
  /** Drop the -1.2deg tilt (for lists, not the globe screen). */
  flat?: boolean;
  className?: string;
  style?: CSSProperties;
}

function PlaceColumn({ place }: { place: Place }) {
  return (
    <div className="pa-ticket-place">
      <div className="pa-ticket-code">{place.code}</div>
      <div className="pa-ticket-city">{place.city}</div>
    </div>
  );
}

/** The result of a trip: both ends, the departure date and the distance. Prices and times go in results, not here. */
export function Ticket({
  from,
  to,
  date,
  distance,
  searching = true,
  onClose,
  closeLabel = "Cancel trip",
  flat = false,
  className,
  style,
}: TicketProps) {
  return (
    <div className={cn("pa-ticket", flat && "pa-ticket-flat", className)} style={style}>
      <div className="pa-ticket-main">
        <PlaceColumn place={from} />
        <Route marching={searching} />
        <PlaceColumn place={to} />
      </div>
      <div className="pa-ticket-stub">
        <div className="pa-ticket-date">{date}</div>
        {distance ? <div className="pa-ticket-meta">{distance}</div> : null}
        {searching ? (
          <div className="pa-dots" role="status" aria-label="Searching">
            <span />
            <span />
            <span />
          </div>
        ) : null}
      </div>
      {onClose ? <RoundButton className="pa-ticket-close" label={closeLabel} onClick={onClose} /> : null}
    </div>
  );
}
