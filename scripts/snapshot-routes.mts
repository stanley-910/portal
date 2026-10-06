// Snapshots Travelpayouts' public route list into a small per-airport table for ranking a city's airports: how many
// direct airline routes leave each airport, and which airport pairs have one. A ranking hint only: the list is old
// (it misses airports that opened since), so a route missing from it is unknown, not absent.
import { writeFile } from "node:fs/promises";

const source = "https://api.travelpayouts.com/data/routes.json";
const output = new URL("../src/lib/transport/hubs/routes.json", import.meta.url);

type SourceRoute = {
  airline_iata?: string | null;
  departure_airport_iata?: string | null;
  arrival_airport_iata?: string | null;
  codeshare?: boolean;
  transfers?: number;
};

const response = await fetch(source);
if (!response.ok) throw new Error(`Route snapshot failed: ${response.status}`);
const routes = (await response.json()) as SourceRoute[];
const out = new Map<string, number>();
const direct = new Set<string>();
const iata = /^[A-Z]{3}$/;
for (const route of routes) {
  const from = route.departure_airport_iata ?? "";
  const to = route.arrival_airport_iata ?? "";
  // an airline's own nonstop: codeshares and connections would count one flight several times
  if (route.codeshare || route.transfers || !iata.test(from) || !iata.test(to) || from === to) continue;
  out.set(from, (out.get(from) ?? 0) + 1);
  direct.add(`${from}${to}`);
}
const snapshot = {
  source,
  fetched: new Date().toISOString().slice(0, 10),
  // airline routes out of each airport, nonstop
  out: Object.fromEntries([...out].sort(([a], [b]) => (a < b ? -1 : 1))),
  // airport pairs with a nonstop, as FROMTO, joined so the file stays small
  direct: [...direct].sort().join(","),
};
await writeFile(output, `${JSON.stringify(snapshot)}\n`, "utf8");
console.log(`Wrote ${out.size} airports and ${direct.size} nonstop pairs to ${output.pathname}`);
