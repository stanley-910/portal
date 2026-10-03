import type { SplitNight } from "./split";

// Pure pieces of editing a leg in the plan panel: which option the editor shows as picked, and the dates a hotel
// is searched for at the leg's destination.

const DAY_MS = 86_400_000;
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * The option the editor shows as picked. `draft` is what this member clicked (undefined before they click); a draft
 * for an option a new search replaced no longer counts, so the stored pick shows again.
 */
export function editorChoice(draft: string | null | undefined, stored: string | null, offerIds: string[]): string | null {
  if (draft === undefined) return stored;
  if (draft !== null && !offerIds.includes(draft)) return stored;
  return draft;
}

/**
 * The nights a hotel at a leg's destination is for, as check-in and check-out dates, and how many people sleep there.
 * The stay is the stop's, shared, so this is the run of nights the split has at that stop around the leg's arrival:
 * from whoever arrives first to the morning the last one leaves. Without nights there (nobody rides it yet), it is the
 * leg's date to the next leg out of the stop or the trip's end, and at least one night.
 */
export function stayDates(
  plan: { nights: Pick<SplitNight, "stop" | "date" | "present">[]; ends: string | null; legs: { from: string; date: string }[] },
  leg: { to: string; date: string; arrival?: string; riders: string[] },
): { checkIn: string; checkOut: string; people: number } {
  const arrival = leg.arrival ?? leg.date;
  const here = new Map(plan.nights.filter((n) => n.stop === leg.to && n.present.length).map((n) => [n.date, n.present.length]));
  if (here.has(arrival)) {
    let first = arrival;
    let last = arrival;
    while (here.has(shift(first, -1))) first = shift(first, -1);
    while (here.has(shift(last, 1))) last = shift(last, 1);
    let people = 0;
    for (let d = first; d <= last; d = shift(d, 1)) people = Math.max(people, here.get(d) ?? 0);
    return { checkIn: first, checkOut: shift(last, 1), people };
  }
  const next = plan.legs.filter((l) => l.from === leg.to && l.date > arrival).map((l) => l.date).sort()[0];
  const until = [next, plan.ends].filter((d): d is string => !!d && d > arrival).sort()[0];
  return { checkIn: arrival, checkOut: until ?? shift(arrival, 1), people: Math.max(1, leg.riders.length) };
}
