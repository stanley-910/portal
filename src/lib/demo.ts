/**
 * Build-time switches for recording a demo. Public on purpose, so the page and the server read the same value. Leave
 * them unset outside a recording: with them on, test fares lose their label and non-Duffel picks book a sandbox flight.
 */

/**
 * Every priced option is Bookable, and settling a pick that isn't a Duffel offer books the cheapest holdable Duffel
 * sandbox flight for the same route and date, charged at the price the leg showed. Duffel's own "Duffel Airways"
 * sandbox fares are dropped from search so only real airline names remain. Pure stagecraft for a recording.
 */
export const DEMO_BOOKING = process.env.NEXT_PUBLIC_DEMO_BOOKING === "1";

/** Hides the Sandbox badge on Duffel test fares. Implied by DEMO_BOOKING. */
export const HIDE_SANDBOX_BADGE = DEMO_BOOKING || process.env.NEXT_PUBLIC_HIDE_SANDBOX_BADGE === "1";
