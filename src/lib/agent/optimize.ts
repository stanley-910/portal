import "server-only";
import { composeRoutes, type ComposeInput, type Composed, type Route } from "@/lib/transport/compose";
import { searchFromCoordinates } from "@/lib/transport/hub-search";
import { KIND } from "@/lib/agent/kind";

export const OPTIMIZE_INSTRUCTION =
  "When someone says a leg costs too much, gives a budget, asks for something cheaper, or wants to arrive with someone else, call the route optimizer first, before any other search. It tries leaving from a nearby station (for example taking the MTR across to Shenzhen for the train to Shanghai), chains the connections, and lines up arrivals. Lead with the best route as one plan: what to take, when, the total, what it saves and when it arrives. Mention the runner-up only if it's a real trade-off. Quote its numbers exactly, say 'about' for converted totals and say estimates are estimates. If nothing beats the direct option, say so plainly.";

const hhmm = (iso: string) => iso.slice(11, 16);
const hours = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;

function describe(r: Route): string {
  const parts = r.parts.map((p) => {
    const what = [p.carrier, p.number].filter(Boolean).join(" ") || p.mode;
    const price = p.price ? `${p.price.currency} ${p.price.amount}` : "fare unknown";
    const when = p.flexible ? `leave ${p.from.name} by ${hhmm(p.depart)} (runs every few minutes)` : `${p.from.name} ${hhmm(p.depart)}`;
    return `${what}: ${when} → ${p.to.name} ${hhmm(p.arrive)}, ${price} (${KIND[p.kind]})`;
  });
  const total = r.total ? `${r.total.converted ? "about " : ""}${r.total.currency} ${r.total.amount}` : "total unknown (a fare is missing)";
  const saves = r.saves === null ? "" : r.saves > 0 ? `, saves ${r.saves}` : r.saves < 0 ? `, costs ${-r.saves} more` : ", same price";
  const gap = r.gapMin === null ? "" : `, arrives ${Math.abs(r.gapMin)} min ${r.gapMin >= 0 ? "after" : "before"} the target`;
  const how = r.via ? `via ${r.via.name}` : "direct";
  return `${r.id} ${how}: ${parts.join("; then ")}. Door to door ${hours(r.durationMin)}, total ${total}${saves}${gap}.`;
}

/** What the model reads: the direct baseline, then up to three alternatives. */
export function describeRoutes(c: Composed): { baseline: string | null; routes: string[]; note: string } {
  return {
    baseline: c.baseline ? describe(c.baseline) : null,
    routes: c.routes.map(describe),
    note: [
      c.routes.length ? "" : "No alternative route was found.",
      c.gateways.length ? `Tried leaving from: ${c.gateways.map((g) => g.name).join(", ")}.` : "No nearby station to leave from instead.",
      "Flights without a scheduled time can't be chained or lined up, so they aren't compared here.",
      "Fares are per person and typical unless marked live; crossing times are typical and longer at peaks.",
    ].filter(Boolean).join(" "),
  };
}

export function optimize(input: ComposeInput, signal: AbortSignal): Promise<Composed> {
  return composeRoutes(input, async (q) => (await searchFromCoordinates(q, signal)).offers);
}
