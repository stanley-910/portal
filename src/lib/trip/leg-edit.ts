// The dates a new stay at a leg's destination starts with, in the plan panel. Pure.

const DAY_MS = 86_400_000;
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * The nights a new stay at a leg's destination covers to begin with, and how many sleep there: from the leg's arrival
 * to the morning its riders next leave the stop, else one night, for its riders. Stays are their own, so these are only
 * where the hotel search starts; the stay's own dates and guests are what count.
 */
export function stayDates(
  legs: { from: string; date: string; riders: string[] }[],
  leg: { to: string; date: string; arrival?: string; riders: string[] },
): { checkIn: string; checkOut: string; people: number } {
  const checkIn = leg.arrival ?? leg.date;
  const out = legs.filter((l) => l.from === leg.to && l.date > checkIn);
  // the riders' own next leg out, else anyone's, so a stay for people who haven't drawn theirs still ends somewhere
  const next = (out.filter((l) => l.riders.some((r) => leg.riders.includes(r))).map((l) => l.date).sort()[0]) ?? out.map((l) => l.date).sort()[0];
  return { checkIn, checkOut: next ?? shift(checkIn, 1), people: Math.max(1, leg.riders.length) };
}
