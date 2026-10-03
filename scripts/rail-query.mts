// Offline station-name query. No API keys, geocoding or network requests.
// node scripts/rail-query.mts 'Hong Kong West Kowloon' 'Shanghai Hongqiao' 2026-10-04
import { readFileSync } from "node:fs";
import { createScheduleSearch } from "../src/lib/transport/providers/rail-cache/search.ts";
import type { ScheduleCache } from "../src/lib/transport/providers/rail-cache/schema.ts";
const cache = JSON.parse(readFileSync(new URL("../src/lib/transport/providers/rail-cache/cache.json", import.meta.url), "utf8")) as ScheduleCache;
const [from, to, date] = process.argv.slice(2);
if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
  throw new Error("Usage: node scripts/rail-query.mts 'from station' 'to station' YYYY-MM-DD");
}
const norm = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\s_-]+/g, "");
function find(input: string): Set<string> {
  const matches = Object.entries(cache.stations).filter(([id, s]) => id === input || [s.name, ...s.aliases].some((name) => norm(name) === norm(input)));
  if (!matches.length) throw new Error(`No cached station named ${input}`);
  return new Set(matches.map(([id]) => id));
}
const result = createScheduleSearch(cache)(find(from), find(to), date).map((j) => ({
  train: j.trip.number || null, operator: j.trip.operator,
  from: cache.stations[j.from].name, to: cache.stations[j.to].name,
  depart: j.depart, arrive: j.arrive, durationMin: j.durationMin,
  calendar: j.trip.calendar, source: cache.sources[j.trip.source], notes: j.trip.notes,
}));
console.log(JSON.stringify(result, null, 2));
