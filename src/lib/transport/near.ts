// Where the person searching is: sent in a header, never the URL, rounded to about a kilometre, and used only to rank
// the airports near where they clicked (resolveHubs). Shared by the page that sends it and the route that reads it.

export const NEAR_HEADER = "x-portal-near";

/** "47.61,-122.33": two decimals, about a kilometre, enough to tell one airport from another. */
export const formatNear = (at: { lat: number; lng: number }) => `${at.lat.toFixed(2)},${at.lng.toFixed(2)}`;

/** The header's place, or null for none or anything that isn't a valid latitude and longitude. */
export function parseNear(value: string | null): { lat: number; lng: number } | null {
  const match = value && /^(-?\d{1,2}(?:\.\d{1,4})?),(-?\d{1,3}(?:\.\d{1,4})?)$/.exec(value.trim());
  if (!match) return null;
  const lat = Number(match[1]), lng = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
