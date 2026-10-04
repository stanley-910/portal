import "server-only";
import { composeRoutes, type ComposeInput, type Composed, type Route } from "@/lib/transport/compose";
import { searchFromCoordinates } from "@/lib/transport/hub-search";
import { KIND } from "@/lib/agent/kind";

export const OPTIMIZE_INSTRUCTION =
  "When someone says a leg costs too much, gives a budget, asks for something cheaper, or wants to arrive with someone else, call the route optimizer first, before any other search. It tries leaving from nearby stations and airports (for example taking the MTR across to Shenzhen for the train to Shanghai, or flying from a cheaper airport an hour away), chains the connections, including overnight ones, and lines up arrivals. Getting to a station or airport nobody runs a timetable for is an estimate from distance: say so. Lead with the best route as one plan: what to take, when, the total, what it saves and when it arrives. Mention the runner-up only if it's a real trade-off. Quote its numbers exactly, say 'about' for converted totals and say estimates are estimates. If nothing beats the direct option, say so plainly. Its fares and times are enough to answer with; don't search again for them.";

const hhmm = (iso: string) => iso.slice(11, 16);
/** "09:00 next day": local time, with how many days after the route set off. */
const at = (iso: string, start: string) => {
  const days = Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(start.slice(0, 10))) / 86_400_000);
  return `${hhmm(iso)}${days === 1 ? " next day" : days > 1 ? ` +${days} days` : ""}`;
};
const hours = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;

/** One route as the model reads it: each part with its times, fare and source, then the total and what it saves. */
export function describeRoute(r: Route): string {
  const parts = r.parts.map((p) => {
    const what = [p.carrier, p.number].filter(Boolean).join(" ") || p.mode;
    const price = p.price ? `${p.price.currency} ${p.price.amount}` : "fare unknown";
    if (p.provider === "ground") {
      return `${what} from ${p.from.name}: leave by ${at(p.depart, r.depart)}, about ${Math.round((Date.parse(p.arrive) - Date.parse(p.depart)) / 60_000)} min to ${p.to.name}, about ${price} (estimated from distance, not a timetable or fare)`;
    }
    const when = p.flexible ? `leave ${p.from.name} by ${at(p.depart, r.depart)} (runs every few minutes)` : `${p.from.name} ${at(p.depart, r.depart)}`;
    return `${what}: ${when} → ${p.to.name} ${at(p.arrive, r.depart)}, ${price} (${KIND[p.kind]})`;
  });
  const total = r.total ? `${r.total.converted ? "about " : ""}${r.total.currency} ${r.total.amount}` : "total unknown (a fare is missing)";
  const cur = r.total?.currency ?? "";
  const saves = r.saves === null ? "" : r.saves > 0 ? `, saves ${cur} ${r.saves}` : r.saves < 0 ? `, costs ${cur} ${-r.saves} more` : ", same price";
  const gap = r.gapMin === null ? "" : `, arrives ${Math.abs(r.gapMin)} min ${r.gapMin >= 0 ? "after" : "before"} the target`;
  const how = r.via ? `via ${r.via.name}` : "direct";
  return `${r.id} ${how} on ${r.depart.slice(0, 10)}: ${parts.join("; then ")}. ${hours(r.durationMin)} from first departure to arrival, total ${total}${saves}${gap}.`;
}

/** What the model reads: the direct baseline, then up to three alternatives. */
export function describeRoutes(c: Composed): { baseline: string | null; routes: string[]; note: string } {
  return {
    baseline: c.baseline ? describeRoute(c.baseline) : null,
    routes: c.routes.map(describeRoute),
    note: [
      c.routes.length ? "" : "No alternative route was found.",
      c.gateways.length ? `Tried leaving from: ${c.gateways.map((g) => g.name).join(", ")}.` : "No nearby station to leave from instead.",
      "Flights without a scheduled time can't be chained or lined up, so they aren't compared here.",
      "Fares are per person and typical unless marked live; crossing times are typical and longer at peaks.",
      "Times and totals cover the services listed; getting to the first station and on from the last one isn't included.",
    ].filter(Boolean).join(" "),
  };
}

export function optimize(input: ComposeInput, signal: AbortSignal): Promise<Composed> {
  return composeRoutes(input, async (q) => (await searchFromCoordinates(q, signal)).offers);
}
