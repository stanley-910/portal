// Airline routes as a ranking hint for a city's airports (scripts/snapshot-routes.mts). Server-side: the table is too
// big for the browser bundle, and only the resolver needs it. Old data: a missing route is unknown, not absent.
import routes from "./routes.json";

const OUT: Record<string, number> = routes.out;
let direct: Set<string> | null = null;

/** Nonstop airline routes out of an airport, by IATA code; 0 when the list doesn't know it. */
export const routesOut = (iata: string | undefined): number => (iata ? OUT[iata] ?? 0 : 0);

/** Whether the list has a nonstop from one airport to the other. */
export function hasNonstop(from: string | undefined, to: string | undefined): boolean {
  if (!from || !to) return false;
  direct ??= new Set(routes.direct.split(","));
  return direct.has(`${from}${to}`);
}
