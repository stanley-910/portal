/**
 * Builds src/data/entry-requirements.json from data/entry/.
 *
 *   node scripts/entry-requirements.mts                         merge, validate, write JSON and report
 *   node scripts/entry-requirements.mts --check                 exit 1 if the JSON is stale (used by `pnpm build`)
 *   node scripts/entry-requirements.mts --providers=govuk,travel-buddy [--max-requests=100]
 *                                                               refresh provider snapshots first (network)
 *   node scripts/entry-requirements.mts --check-links           also request every official link and report failures
 *
 * A plain run needs no network and no keys: providers write committed snapshots in data/entry/providers/.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { buildEntryData, parseDatasetCsv, type BuildReport } from "../src/lib/entry/build.ts";
import { composeRule } from "../src/lib/entry/compose.ts";
import { CuratedEntry, DatasetMeta, Destination, ProviderSnapshot, type EntryData } from "../src/lib/entry/schema.ts";
import { govukProvider } from "./entry/providers/govuk.mts";
import { travelBuddyProvider } from "./entry/providers/travel-buddy.mts";
import type { EntryProvider } from "./entry/providers/types.mts";

const root = fileURLToPath(new URL("..", import.meta.url));
const DATA = join(root, "data/entry");
const OUT = join(root, "src/data/entry-requirements.json");
const REPORT = join(DATA, "report.md");
const PROVIDERS: EntryProvider[] = [govukProvider, travelBuddyProvider];
const STALE_DAYS = 90;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

function parse<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    console.error(`${where}\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }
  return result.data;
}

const config = parse(
  z.object({ passports: z.array(z.string()), destinations: z.array(z.string()) }),
  readJson(join(DATA, "config.json")),
  "data/entry/config.json",
);
const meta = parse(DatasetMeta, readJson(join(DATA, "passport-index.meta.json")), "data/entry/passport-index.meta.json");
const destinations = parse(z.array(Destination), readJson(join(DATA, "destinations.json")), "data/entry/destinations.json");
const curated = readdirSync(join(DATA, "curated"))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .flatMap((f) => parse(z.array(CuratedEntry), readJson(join(DATA, "curated", f)), `data/entry/curated/${f}`));

async function refreshProviders(ids: string[]) {
  const pairs = config.passports.flatMap((passport) =>
    config.destinations.filter((d) => d !== passport).map((destination) => ({ passport, destination })),
  );
  for (const id of ids) {
    const provider = PROVIDERS.find((p) => p.id === id);
    if (!provider) throw new Error(`Unknown provider "${id}". Known: ${PROVIDERS.map((p) => p.id).join(", ")}`);
    const reason = provider.unavailable?.();
    if (reason) {
      console.warn(`Skipping ${id}: ${reason}`);
      continue;
    }
    const results = await provider.run({
      pairs,
      destinations,
      maxRequests: Number(option("max-requests") ?? 100),
      cacheDir: join(DATA, ".cache"),
      log: (m) => console.log(m),
    });
    const snapshot: ProviderSnapshot = { provider: id, fetchedAt: new Date().toISOString().slice(0, 10), results };
    mkdirSync(join(DATA, "providers"), { recursive: true });
    writeFileSync(join(DATA, "providers", `${id}.json`), JSON.stringify(parse(ProviderSnapshot, snapshot, id), null, 2) + "\n");
  }
}

function readSnapshots(): ProviderSnapshot[] {
  const dir = join(DATA, "providers");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => parse(ProviderSnapshot, readJson(join(dir, f)), `data/entry/providers/${f}`));
}

async function checkLinks(data: EntryData): Promise<string[]> {
  const urls = new Set<string>();
  for (const rule of data.rules) {
    for (const l of composeRule(rule, data.destinations[rule.destination], data.dataset).links) urls.add(l.url);
  }
  const failures: string[] = [];
  await Promise.all(
    [...urls].map(async (url) => {
      try {
        const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (entry link check)" }, signal: AbortSignal.timeout(15_000) });
        // 403 is almost always bot protection on a live government page, so only flag real failures.
        if (!res.ok && res.status !== 403) failures.push(`${res.status} ${url}`);
      } catch (e) {
        failures.push(`error ${url} (${(e as Error).message})`);
      }
    }),
  );
  return failures.sort();
}

function renderReport(report: BuildReport, data: EntryData, snapshots: ProviderSnapshot[], linkFailures?: string[]) {
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "None.");
  const counts = (r: Record<string, number>) =>
    Object.entries(r)
      .sort()
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
  // Relative to the newest check rather than today, so the report is reproducible.
  const newest = Math.max(0, ...report.curated.map((c) => Date.parse(c.verifiedAt)));
  const stale = report.curated
    .filter((c) => newest - Date.parse(c.verifiedAt) > STALE_DAYS * 86_400_000)
    .map((c) => `${c.key} (verified ${c.verifiedAt})`);

  return `# Entry requirements build report

Generated by \`pnpm entry\`. Do not edit.

- Dataset: ${data.dataset.name}, snapshot ${data.dataset.snapshotDate} (\`${data.dataset.commit.slice(0, 7)}\`)
- Passports: ${config.passports.join(", ")}
- Destinations: ${config.destinations.join(", ")}
- Rules: ${data.rules.length} (${counts(report.rulesByOrigin)})
- Kinds: ${counts(report.rulesByKind)}
- Provider snapshots: ${snapshots.length ? snapshots.map((s) => `${s.provider} (${s.fetchedAt}, ${s.results.length} pairs)`).join(", ") : "none"}

## Provider disagreements

Resolve each by checking the official source and adding a curated entry.

${list(report.disagreements.map((d) => `${d.passport}→${d.destination}: ours ${d.ours} (${d.origin}), ${d.provider} says ${d.theirs}`))}

## Dataset-only pairs in the demo region

Shown with the "estimated" badge. Curate any that sit on the demo route.

${list(report.unverifiedDemoPairs)}

## Curated entries

${list(report.curated.map((c) => `${c.key}, verified ${c.verifiedAt}`))}

## Curated entries more than ${STALE_DAYS} days older than the newest

${list(stale)}

## Configured pairs with no data

${list(report.missingPairs)}

## Unrecognised dataset values

${list(report.unmappedValues)}
${linkFailures ? `\n## Link check\n\n${list(linkFailures)}\n` : ""}`;
}

const providerIds = option("providers")?.split(",").filter(Boolean) ?? [];
if (providerIds.length) await refreshProviders(providerIds);

const snapshots = readSnapshots();
let built;
try {
  built = buildEntryData({
    config,
    dataset: { meta, rows: parseDatasetCsv(readFileSync(join(DATA, "passport-index.csv"), "utf8")) },
    curated,
    destinations,
    providers: snapshots,
  });
} catch (e) {
  console.error(`Entry build failed: ${(e as Error).message}`);
  process.exit(1);
}

const json = JSON.stringify(built.data, null, 2) + "\n";

if (flag("check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== json) {
    console.error("src/data/entry-requirements.json is stale. Run `pnpm entry`.");
    process.exit(1);
  }
  console.log("Entry requirements are up to date.");
} else {
  mkdirSync(join(root, "src/data"), { recursive: true });
  writeFileSync(OUT, json);
  const linkFailures = flag("check-links") ? await checkLinks(built.data) : undefined;
  writeFileSync(REPORT, renderReport(built.report, built.data, snapshots, linkFailures));
  const { rulesByOrigin, disagreements } = built.report;
  console.log(
    `Wrote ${built.data.rules.length} rules (${Object.entries(rulesByOrigin).map(([k, v]) => `${k} ${v}`).join(", ")}). ` +
      `${disagreements.length} provider disagreements. Report: data/entry/report.md`,
  );
  if (linkFailures?.length) console.warn(`${linkFailures.length} links failed. See the report.`);
}
