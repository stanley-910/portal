import { distanceKm } from "./hubs/geo";
import type { Place } from "./types";

/**
 * Getting to a station or airport that isn't where someone is, when nothing models the actual link: a modelled
 * estimate from straight-line distance, always shown as one. Roughly public transport or a shared taxi: about 50 km/h
 * door to door after a 20-minute start, USD 2 plus 10 cents a km, and an hour and USD 5 more to cross a border.
 * Nobody sets off before 06:00 on one.
 */
export interface GroundEstimate {
  minutes: number;
  price: { amount: number; currency: "USD" };
  crossing: boolean;
  km: number;
}

const START_MIN = 20;
const KMH = 50;
const CROSSING_MIN = 60;
/** Local hour before which nobody is assumed to be on their way. */
export const EARLIEST_HOUR = 6;

export function groundEstimate(from: Place, to: Place, crossing: boolean): GroundEstimate {
  const km = distanceKm(from, to);
  return {
    minutes: Math.round(START_MIN + (km / KMH) * 60 + (crossing ? CROSSING_MIN : 0)),
    price: { amount: Math.round(2 + km * 0.1 + (crossing ? 5 : 0)), currency: "USD" },
    crossing,
    km: Math.round(km),
  };
}

/** Text for the estimate's source, said wherever it's shown. */
export const GROUND_NOTE =
  "Estimated from straight-line distance (about 50 km/h by public transport or taxi, plus an hour at a border); not a timetable or a fare.";
