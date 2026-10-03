/**
 * Offline source evidence / review-age check. Never downloads or rewrites seeds.
 *   node scripts/check-ferry-sources.mts --check --as-of 2026-10-03
 *   node scripts/check-ferry-sources.mts --compare batamfast /path/to/saved-page.html
 *   node scripts/check-ferry-sources.mts --compare brf /path/to/copied-timetable.txt
 *   node scripts/check-ferry-sources.mts --compare camellia /path/to/new-brochure.pdf
 *
 * A changed source is a failed check requiring human review, not an automatic refresh.
 * BRF returns 403 to direct fetching; no request scraper or bypass is attempted.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ferrySeedSchema } from "../src/lib/transport/providers/official-ferries/schema.ts";

const folder = fileURLToPath(new URL("../src/lib/transport/providers/official-ferries/", import.meta.url));
const sources: Array<{ id: string; url: string; checked: string; file: string; method: string; sha256: string; upstreamSha256?: string }> =
  JSON.parse(readFileSync(`${folder}fixtures/sources.json`, "utf8"));
const seed = ferrySeedSchema.parse(JSON.parse(readFileSync(`${folder}seed.json`, "utf8")));
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const text = (input: string) => input.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
function batamTable(input: string) {
  const tables = input.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) ?? [];
  const matching = tables.filter((table) => /Harbourfront/i.test(table) && /Tanah Merah/i.test(table) && /Batam Center/i.test(table));
  if (matching.length !== 1) throw new Error("Expected exactly one Batam Center timetable table; layout changed.");
  // Header/cell boundaries and footnote markers matter; do not flatten all times into a set.
  return matching[0].replace(/<(th|td)\b[^>]*>/gi, " | ").replace(/<\/tr>/gi, " ; ");
}
const args = process.argv.slice(2);
try {
  for (const source of sources) {
    const bytes = readFileSync(`${folder}fixtures/${source.file}`);
    if (digest(bytes) !== source.sha256) throw new Error(`${source.id}: recorded evidence hash changed; review source and manifest together.`);
    if (source.checked !== seed.checked) throw new Error(`${source.id}: source and seed review dates differ.`);
  }
  if (args[0] === "--compare") {
    const source = sources.find((s) => s.id === args[1]);
    if (!source || !args[2] || args.length !== 3) throw new Error("Usage: --compare batamfast|brf|camellia /path/to/saved-source");
    const candidate = readFileSync(args[2]);
    const baseline = readFileSync(`${folder}fixtures/${source.file}`, "utf8");
    const equal = source.method === "pdf" ? digest(candidate) === source.upstreamSha256
      : source.method === "html-table" ? text(batamTable(candidate.toString())) === text(batamTable(baseline))
      : text(candidate.toString()) === text(baseline);
    if (!equal) throw new Error(`${source.id}: source changed. Review dates, directions, footnotes, cancellations and durations before updating seed. Seed unchanged.`);
    console.log(`${source.id}: selected source content matches recorded evidence; this does not confirm live seats or cancellations.`);
  } else {
    if (args.length && args[0] !== "--check") throw new Error("Use --check [--as-of YYYY-MM-DD] or --compare source path.");
    const index = args.indexOf("--as-of");
    const today = index >= 0 ? args[index + 1] : new Date().toISOString().slice(0, 10);
    if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(Date.parse(today))) throw new Error("Invalid --as-of date");
    const age = (Date.parse(today) - Date.parse(seed.checked)) / 86_400_000;
    if (age > 30 || age < 0) throw new Error(`Source review required: snapshot checked ${seed.checked}, as-of ${today}. Manual review interval is 30 days; seed unchanged.`);
    console.log(`${seed.routes.length} timetable rows validated; source evidence intact, reviewed ${seed.checked}. No live inventory claimed.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Ferry source check failed");
  process.exitCode = 1;
}
