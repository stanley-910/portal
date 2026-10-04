import { showDate as day, type PlanJson } from "@/lib/agent/snapshot";
import type { StoredOffer } from "@/lib/liveblocks/types";
import { distanceKm } from "@/lib/transport/hubs/geo";

// Things in a trip worth Pip speaking up about, each with a fix someone can apply in one tap. Pure, so the room's
// clients spot them as the plan changes and the server checks them again before posting or fixing anything. Each reads
// as what Pip noticed, then a question its fixes answer; the trip's Pip panel keeps them under Observations, out of
// the chat.

/** Arrivals into one city further apart than this are worth a word. */
export const APART_MIN = 180;
/** Stops this close are the same city for meeting up. */
const SAME_CITY_KM = 50;

export type Fix =
  /** Everyone on `keep`, and `drop` removed: the same trip on two legs becomes one. */
  | { kind: "merge"; label: string; keep: string; drop: string }
  /** A leg home for someone leaving early. */
  | { kind: "home"; label: string; member: string; from: string; to: string; date: string }
  /** Needs judgement: asks Pip in the clicker's name. */
  | { kind: "ask"; label: string; prompt: string };

/** `text` is what Pip noticed and then what it asks: "… on different trains. Should you all take the same one?" */
export type Issue = { key: string; text: string; fixes: Fix[] };

type Plan = PlanJson;
type Leg = NonNullable<Plan["legs"]>[string];

const chosenOf = (l: Leg): StoredOffer | null => l.search?.offers?.find((o) => o.id === l.chosen) ?? null;
const hhmm = (iso: string) => iso.slice(11, 16);
/** "HX234 18:30", or "the 18:30 train". */
const service = (o: StoredOffer) => (o.flights?.[0]?.number ? `${o.flights[0].number} ${hhmm(o.depart)}` : `the ${hhmm(o.depart)} ${o.carrier ?? o.mode}`);
const names = (plan: Plan, ids: readonly string[]) => {
  const list = ids.map((id) => plan.members?.[id]?.name ?? "Someone");
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : (list[0] ?? "Nobody");
};
/** Where an offer lands: the airport or station, when it says. */
const landsAt = (o: StoredOffer) => o.flights?.at(-1)?.to ?? o.arrives ?? null;

export function planIssues(plan: Plan): Issue[] {
  const stops = plan.stops ?? {};
  const legs = Object.entries(plan.legs ?? {}).filter(([, l]) => l.riders.length && stops[l.from] && stops[l.to]);
  const near = (a: string, b: string) => a === b || distanceKm(stops[a], stops[b]) <= SAME_CITY_KM;
  const issues: Issue[] = [];
  const merged = new Set<string>();

  // the same trip on two legs with different services picked: people who meant to travel together, apart
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const [aId, a] = legs[i], [bId, b] = legs[j];
      if (a.date !== b.date || !near(a.from, b.from) || !near(a.to, b.to) || a.booking || b.booking) continue;
      const ca = chosenOf(a), cb = chosenOf(b);
      if (!ca || !cb || ca.kind === "estimated" || cb.kind === "estimated" || service(ca) === service(cb)) continue;
      merged.add(aId).add(bId);
      const [first, second] = [aId, bId].sort();
      issues.push({
        key: `split:${first}:${second}:${ca.id}:${cb.id}`,
        text: `${names(plan, a.riders)} and ${names(plan, b.riders)} are both going ${stops[a.from].name} → ${stops[a.to].name} on ${day(a.date)}, but on different services: ${service(ca)} and ${service(cb)}. Should you all take the same one?`,
        fixes: [
          { kind: "merge", label: `All on ${service(ca)}`, keep: aId, drop: bId },
          { kind: "merge", label: `All on ${service(cb)}`, keep: bId, drop: aId },
        ],
      });
    }
  }

  // into one city the same day, hours apart
  const byArrival = new Map<string, { id: string; leg: Leg; offer: StoredOffer }[]>();
  for (const [id, l] of legs) {
    const o = chosenOf(l);
    if (!o || o.kind === "estimated" || merged.has(id)) continue;
    // grouped by city and day: Pudong and Hongqiao are both Shanghai
    const into = [...byArrival.keys()].find((k) => { const [stop, date] = k.split("|"); return date === l.date && near(stop, l.to); }) ?? `${l.to}|${l.date}`;
    byArrival.set(into, [...(byArrival.get(into) ?? []), { id, leg: l, offer: o }]);
  }
  for (const [key, arrivals] of byArrival) {
    if (arrivals.length < 2 || new Set(arrivals.map((a) => a.leg.from)).size < 2) continue;
    const sorted = [...arrivals].sort((x, y) => Date.parse(x.offer.arrive) - Date.parse(y.offer.arrive));
    const first = sorted[0], last = sorted.at(-1)!;
    const gap = Math.round((Date.parse(last.offer.arrive) - Date.parse(first.offer.arrive)) / 60_000);
    if (gap <= APART_MIN) continue;
    const [stop, date] = key.split("|");
    const city = stops[stop].name;
    const at = (a: typeof first) => `${hhmm(a.offer.arrive)}${landsAt(a.offer) ? ` (${landsAt(a.offer)})` : ""}`;
    issues.push({
      key: `apart:${key}:${sorted.map((a) => a.offer.id).join(",")}`,
      text: `${names(plan, first.leg.riders)} get${first.leg.riders.length > 1 ? "" : "s"} to ${city} at ${at(first)} and ${names(plan, last.leg.riders)} at ${at(last)}, ${Math.floor(gap / 60)}h${String(gap % 60).padStart(2, "0")} apart. Want me to line the arrivals up?`,
      fixes: [{ kind: "ask", label: "Line them up", prompt: `Line up everyone's arrivals into ${city} on ${date} so we get in close together, as cheaply as you can.` }],
    });
  }

  // leaving early with no way out
  for (const [member, m] of Object.entries(plan.members ?? {})) {
    if (!m.leaves) continue;
    const theirs = legs.filter(([, l]) => l.riders.includes(member)).sort(([, a], [, b]) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    if (!theirs.length || theirs.some(([, l]) => l.date === m.leaves)) continue;
    const home = theirs[0][1].from;
    // where they are when they leave: the end of their last leg before then
    const there = [...theirs].reverse().find(([, l]) => l.date <= m.leaves!)?.[1].to;
    if (!there || near(there, home)) continue;
    issues.push({
      key: `home:${member}:${m.leaves}:${there}:${home}`,
      text: `${m.name} leaves ${stops[there].name} on ${day(m.leaves)} but has no way home to ${stops[home].name} yet. Should I add one?`,
      fixes: [{ kind: "home", label: `Add ${m.name}'s way home`, member, from: there, to: home, date: m.leaves }],
    });
  }
  return issues;
}
