import { showDate } from "@/lib/agent/snapshot";

// What the chat's header says about the trip, and what it suggests asking Pip next, from the plan as it stands:
// the route so far, and the next gap in it (someone with no way there, a leg nobody has compared, no way home).

/** The parts of Storage this reads; both the room's snapshot and the server's JSON fit. */
export type PlanView = {
  members?: Readonly<Record<string, { name: string }>> | null;
  stops?: Readonly<Record<string, { name: string }>> | null;
  legs?: Readonly<
    Record<string, { from: string; to: string; date: string; riders: readonly string[]; chosen: string | null; createdAt: number; search: { status: string; offers: readonly unknown[] } }>
  > | null;
};

export type TripContext = { line: string; chips: string[] };

const MAX_CHIPS = 3;

export function tripContext(plan: PlanView, me: string | undefined): TripContext {
  const members = Object.entries(plan.members ?? {});
  const name = (stop: string) => plan.stops?.[stop]?.name ?? "somewhere";
  const legs = Object.values(plan.legs ?? {}).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const group = members.length > 1;

  // the route as one chain of places, repeats folded: Hong Kong → Shanghai → Tokyo
  const places: string[] = [];
  for (const leg of legs) {
    if (places.at(-1) !== name(leg.from)) places.push(name(leg.from));
    places.push(name(leg.to));
  }
  const route = places.length > 3 ? `${places[0]} → … → ${places.at(-1)}` : places.join(" → ");
  const line = [route || "No legs yet", legs[0] ? showDate(legs[0].date) : null, group ? `${members.length} people` : null]
    .filter(Boolean)
    .join(" · ");

  if (!legs.length) {
    const chips = group
      ? ["Where should we meet?", "Somewhere fair in the middle", "Somewhere quick for everyone to reach"]
      : ["Train from Hong Kong to Shanghai on Friday", "Cheapest way from Taipei to Tokyo next week", "Where should I meet a friend from Seoul?"];
    return { line, chips: chips.slice(0, MAX_CHIPS) };
  }

  const chips: string[] = [];
  const riding = new Set(legs.flatMap((l) => l.riders));
  const stranded = members.find(([id]) => !riding.has(id));
  if (stranded) {
    const [id, m] = stranded;
    chips.push(id === me ? `How do I get to ${name(legs[0].to)}?` : `How does ${m.name} get to ${name(legs[0].to)}?`);
  }
  const unpicked = legs.filter((l) => !l.chosen && l.search.status === "done" && l.search.offers.length);
  if (unpicked.length === 1) chips.push(`What's best from ${name(unpicked[0].from)} to ${name(unpicked[0].to)}?`);
  else if (unpicked.length > 1) chips.push("What's cheapest on each leg?");
  const start = name(legs[0].from);
  if (name(legs.at(-1)!.to) !== start) chips.push(group ? `How do we get back to ${start}?` : `How do I get back to ${start}?`);
  if (group) chips.push("Who pays what?");
  chips.push("What's on the trip so far?");
  return { line, chips: chips.slice(0, MAX_CHIPS) };
}
