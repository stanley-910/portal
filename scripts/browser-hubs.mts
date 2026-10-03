// Compact, lossless browser catalogue. Server providers retain the source JSON.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Hub } from "../src/lib/transport/hubs/types.ts";
const base = new URL("../src/lib/transport/hubs/", import.meta.url);
const read = (name: string): Hub[] => JSON.parse(readFileSync(new URL(name, base), "utf8"));
const hubs = [...read("airports.json"), ...read("surface-hubs.json")];
const sources = [...new Set(hubs.map((h) => h.source))];
// Airport IDs and IATA duplicate the code; preserve them implicitly. Surface records stay whole.
const airports = hubs.filter((h) => h.mode === "flight").map((h) => [h.code, h.name, h.city, h.lat, h.lng, h.country, h.importance, sources.indexOf(h.source)]);
const surface = hubs.filter((h) => h.mode !== "flight");
const output = JSON.stringify({ sources, airports, surface }) + "\n";
const path = fileURLToPath(new URL("browser-data.json", base));
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== output) throw new Error("Browser hubs are stale. Run pnpm browser-hubs.");
} else writeFileSync(path, output);
