// Build-time only. Official public factual timetable; no fares/seats/booking API.
// node scripts/snapshot-vietnam-trains.mts [--fresh|--check]
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTimetable, seedSchema, SOURCE } from "../src/lib/transport/providers/vietnam-rail/snapshot.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
if (process.argv.includes("--check")) {
  const seed = seedSchema.parse(JSON.parse(readFileSync(`${root}src/lib/transport/providers/vietnam-rail/seed.json`, "utf8")));
  const recorded = readFileSync(`${root}src/lib/transport/providers/vietnam-rail/__fixtures__/endpoints.html`, "utf8");
  const parsed = parseTimetable(recorded, seed.checked);
  if (JSON.stringify(parsed) !== JSON.stringify(seed)) throw new Error("DSVN snapshot differs from recorded endpoint fixture; review and record the refreshed source");
  if (seed.checked > new Date().toISOString().slice(0, 10)) throw new Error("DSVN checked date is in the future");
  console.log(`DSVN offline snapshot check: ${seed.trains.length} trains, checked ${seed.checked}`);
  process.exit(0);
}
const cache = `${root}.cache/vietnam-rail/`;
const path = `${cache}timetable.html`;
mkdirSync(cache, { recursive: true });
let html: string;
let checked: string;
if (!process.argv.includes("--fresh") && existsSync(path) && Date.now() - statSync(path).mtimeMs < 86_400_000) {
  html = readFileSync(path, "utf8");
  checked = statSync(path).mtime.toISOString().slice(0, 10);
} else {
  // robots.txt returned 404 on 2026-10-03. Recheck before every fetch; changed rules fail closed for review.
  const signal = AbortSignal.timeout(8_000);
  const robots = await fetch(new URL("robots.txt", SOURCE), { signal });
  if (robots.status !== 404) throw new Error("DSVN robots.txt changed; review terms and directives before refreshing");
  const response = await fetch(SOURCE, { signal });
  if (!response.ok) throw new Error(`DSVN HTTP ${response.status}; snapshot unchanged`);
  html = await response.text();
  checked = new Date().toISOString().slice(0, 10);
  parseTimetable(html, checked); // never poison the cache with an error page
  writeFileSync(path, html);
}
const seed = parseTimetable(html, checked);
const target = `${root}src/lib/transport/providers/vietnam-rail/seed.json`;
writeFileSync(`${target}.tmp`, `${JSON.stringify(seed, null, 2)}\n`);
renameSync(`${target}.tmp`, target);
console.log(`DSVN: ${seed.trains.length} typical trains, checked ${checked}; no confirmed service dates, fares or seats`);
