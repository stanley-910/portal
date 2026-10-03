/** Destination-local calendar date, never the viewer's clock or a modelled schedule. */
export function arrivalDate(departureDate: string, offer?: { kind: string; arrive?: string; depart?: string } | null): string {
  if (!offer || offer.kind === "estimated" || !offer.arrive ||
    (offer.depart && offer.depart.slice(0, 10) !== departureDate)) return departureDate;
  // Z denotes an unknown destination clock in cached providers. +00:00 can be a known local clock (e.g. London).
  if (!/^\d{4}-\d{2}-\d{2}T.*[+-]\d{2}:\d{2}$/.test(offer.arrive) || !Number.isFinite(Date.parse(offer.arrive))) return departureDate;
  const day = offer.arrive.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day ? day : departureDate;
}
