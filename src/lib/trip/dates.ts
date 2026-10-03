// Keeps a trip's dates in order, for the plan panel and Pip alike. Pure: dates are YYYY-MM-DD strings, compared as
// text, so no time zone ever comes into it.
//
// - A rider's legs go in date order (ties by drawing order, like the split). A leg can't leave before the legs that
//   come before it for any of its riders, and moving it later pushes theirs along to the same day.
// - The trip's end is never before its latest leg.
// - A leave date is never before the member's first leg, nor after the trip's end when one is set.

export type DatePlan = {
  legs?: Record<string, { date: string; riders: string[]; createdAt: number; booking?: unknown }>;
  members?: Record<string, { leaves?: string | null }>;
  ends?: string | null;
};

/** What to write: legs to re-date, leave dates to move, and the trip's end (undefined leaves it). */
export type DateChanges = {
  legs: Record<string, string>;
  leaves: Record<string, string>;
  ends?: string | null;
};

const later = (a: string, b: string | null | undefined) => (b && b > a ? b : a);

/** Legs in the order riders take them: by date, then as drawn. */
function ordered(plan: DatePlan) {
  return Object.entries(plan.legs ?? {}).sort(([, a], [, b]) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
}

/** The latest leg's date, the earliest the trip can end. */
export function lastLegDate(plan: DatePlan): string | null {
  return ordered(plan).at(-1)?.[1].date ?? null;
}

/** The latest leg before this one that shares a rider with it: this leg can't leave before that one. */
export function legBefore(plan: DatePlan, legId: string): { leg: string; date: string } | null {
  const legs = ordered(plan);
  const at = legs.findIndex(([id]) => id === legId);
  if (at < 0) return null;
  const riders = legs[at][1].riders;
  for (let i = at - 1; i >= 0; i--) {
    const [id, leg] = legs[i];
    if (leg.riders.some((r) => riders.includes(r))) return { leg: id, date: leg.date };
  }
  return null;
}

/** The range a member's leave date can take: from their first leg (or the trip's, if they ride none) to its end. */
export function leaveBounds(plan: DatePlan, member: string): { min: string | null; max: string | null } {
  const legs = ordered(plan);
  const first = legs.find(([, l]) => l.riders.includes(member)) ?? legs[0];
  return { min: first?.[1].date ?? null, max: plan.ends ?? null };
}

/** A leave date clamped into `leaveBounds`; null stays null ("stays to the end"). */
export function clampLeave(plan: DatePlan, member: string, date: string | null): string | null {
  if (!date) return null;
  const { min, max } = leaveBounds(plan, member);
  const atLeast = later(date, min);
  return max && atLeast > max ? max : atLeast;
}

/** Leave dates and the trip's end, moved just far enough to fit the legs as they are. */
export function settle(plan: DatePlan): DateChanges {
  const changes: DateChanges = { legs: {}, leaves: {} };
  const last = lastLegDate(plan);
  let ends = plan.ends ?? null;
  if (ends && last && ends < last) changes.ends = ends = last;
  const fitted = { ...plan, ends };
  for (const [id, member] of Object.entries(plan.members ?? {})) {
    if (!member.leaves) continue;
    const leaves = clampLeave(fitted, id, member.leaves);
    if (leaves && leaves !== member.leaves) changes.leaves[id] = leaves;
  }
  return changes;
}

/** Setting the trip's end: never before its latest leg, and leave dates after it come back to it. */
export function setEnds(plan: DatePlan, date: string | null): DateChanges {
  const ends = date ? later(date, lastLegDate(plan)) : null;
  return { ...settle({ ...plan, ends }), ends };
}

/**
 * Moving a leg to `date`. It goes no earlier than the leg before it (`legBefore`); every later leg that shares a rider
 * along the way is pushed to the new date if it would now leave first, and the trip's end and leave dates follow.
 * `blocked` lists legs being booked that would have to move: their dates are fixed, so the move shouldn't happen.
 */
export function moveLeg(plan: DatePlan, legId: string, date: string): DateChanges & { date: string; blocked: string[] } {
  const legs = ordered(plan);
  const at = legs.findIndex(([id]) => id === legId);
  if (at < 0) return { legs: {}, leaves: {}, date, blocked: [] };
  const target = later(date, legBefore(plan, legId)?.date);
  const moved: Record<string, string> = { [legId]: target };
  const blocked: string[] = [];
  // the earliest each rider can next leave, walking forward from the moved leg in the old order
  const floor = new Map<string, string>(legs[at][1].riders.map((r) => [r, target]));
  for (const [id, leg] of legs.slice(at + 1)) {
    const due = leg.riders.reduce((d, r) => later(d, floor.get(r)), leg.date);
    if (due !== leg.date) {
      if (leg.booking) blocked.push(id);
      moved[id] = due;
    }
    for (const r of leg.riders) floor.set(r, later(due, floor.get(r)));
  }
  const next: DatePlan = {
    ...plan,
    legs: Object.fromEntries(legs.map(([id, l]) => [id, moved[id] ? { ...l, date: moved[id] } : l])),
  };
  const legsChanged = Object.fromEntries(Object.entries(moved).filter(([id, d]) => plan.legs![id].date !== d));
  return { ...settle(next), legs: legsChanged, date: target, blocked };
}
