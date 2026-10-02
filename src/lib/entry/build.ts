// Merges the dataset, curated overrides and provider snapshots into the generated entry file.
// Pure: the CLI in scripts/entry-requirements.mts does all file and network access.
import { composeRule } from "./compose.ts";
import {
  ComposedEntryRule,
  type CuratedEntry,
  type DatasetMeta,
  type Destination,
  type EntryData,
  EntryRule,
  type EntryKind,
  type ProviderSnapshot,
} from "./schema.ts";

export interface DatasetRow {
  passport: string;
  destination: string;
  value: string;
}

export interface BuildConfig {
  passports: string[];
  destinations: string[];
}

export interface BuildInput {
  config: BuildConfig;
  dataset: { meta: DatasetMeta; rows: DatasetRow[] };
  curated: CuratedEntry[];
  destinations: Destination[];
  providers: ProviderSnapshot[];
}

export interface Disagreement {
  passport: string;
  destination: string;
  provider: string;
  ours: EntryKind;
  origin: "curated" | "dataset";
  theirs: EntryKind;
}

export interface BuildReport {
  rulesByOrigin: Record<string, number>;
  rulesByKind: Record<string, number>;
  disagreements: Disagreement[];
  /** Pairs in destinations with official links (the demo region) that still rely on the dataset alone. */
  unverifiedDemoPairs: string[];
  /** Configured pairs with no data at all. They render as "No data". */
  missingPairs: string[];
  unmappedValues: string[];
  curated: { key: string; verifiedAt: string }[];
}

/** Maps a Passport Index cell. Returns null for the same-country marker, undefined for a value we don't know. */
export function mapDatasetValue(value: string): { kind: EntryKind; allowedDays?: number } | null | undefined {
  const v = value.trim().toLowerCase();
  if (v === "-1") return null;
  if (/^\d+$/.test(v)) return { kind: "visa_free", allowedDays: Number(v) };
  switch (v) {
    case "visa free":
      return { kind: "visa_free" };
    case "visa on arrival":
      return { kind: "visa_on_arrival" };
    case "eta":
      return { kind: "eta" };
    case "e-visa":
      return { kind: "e_visa" };
    case "visa required":
      return { kind: "visa_required" };
    case "no admission":
      return { kind: "no_admission" };
    default:
      return undefined;
  }
}

/** Parses the tidy ISO-3 CSV: Passport,Destination,Requirement. No quoted fields occur in it. */
export function parseDatasetCsv(csv: string): DatasetRow[] {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  if (header.trim() !== "Passport,Destination,Requirement") {
    throw new Error(`Unexpected dataset header: ${header}`);
  }
  return lines.map((line) => {
    const [passport, destination, value] = line.split(",");
    return { passport, destination, value };
  });
}

const key = (context: string, passport: string, destination: string) => `${context}:${passport}:${destination}`;

function expandCurated(entries: CuratedEntry[], passports: Set<string>): Map<string, EntryRule> {
  const out = new Map<string, EntryRule>();
  for (const { passport, passports: list, ...entry } of entries) {
    const holders = passport ? [passport] : list!.filter((p) => passports.has(p));
    for (const p of holders) {
      const k = key(entry.context, p, entry.destination);
      if (out.has(k)) throw new Error(`Duplicate curated entry ${k}`);
      out.set(k, { ...entry, passport: p, origin: "curated", freshness: "cached" });
    }
  }
  return out;
}

export function buildEntryData(input: BuildInput): { data: EntryData; report: BuildReport } {
  const { config, dataset, providers } = input;
  const passports = new Set(config.passports);
  const destinations = Object.fromEntries(input.destinations.map((d) => [d.code, d]));
  const demoRegion = new Set(input.destinations.filter((d) => d.links.length > 0).map((d) => d.code));

  const report: BuildReport = {
    rulesByOrigin: {},
    rulesByKind: {},
    disagreements: [],
    unverifiedDemoPairs: [],
    missingPairs: [],
    unmappedValues: [],
    curated: [],
  };

  const datasetRules = new Map<string, EntryRule>();
  for (const row of dataset.rows) {
    if (!passports.has(row.passport)) continue;
    const mapped = mapDatasetValue(row.value);
    if (mapped === null) continue;
    if (mapped === undefined) {
      report.unmappedValues.push(`${row.passport}→${row.destination}: ${row.value}`);
      continue;
    }
    datasetRules.set(key("entry", row.passport, row.destination), {
      passport: row.passport,
      destination: row.destination,
      context: "entry",
      ...mapped,
      conditions: [],
      links: [],
      origin: "dataset",
      freshness: "estimated",
      datasetSnapshot: dataset.meta.snapshotDate,
    });
  }

  const curated = expandCurated(input.curated, passports);
  const rules = new Map<string, EntryRule>(curated);

  for (const p of config.passports) {
    for (const d of config.destinations) {
      if (p === d) continue;
      const k = key("entry", p, d);
      if (rules.has(k)) continue;
      const fromDataset = datasetRules.get(k);
      if (fromDataset) rules.set(k, fromDataset);
      else report.missingPairs.push(`${p}→${d}`);
    }
  }

  for (const snapshot of providers) {
    for (const result of snapshot.results) {
      const rule = rules.get(key("entry", result.passport, result.destination));
      if (!rule) continue;
      if (result.kind && result.kind !== rule.kind && rule.origin !== "provider") {
        report.disagreements.push({
          passport: rule.passport,
          destination: rule.destination,
          provider: snapshot.provider,
          ours: rule.kind,
          origin: rule.origin as "curated" | "dataset",
          theirs: result.kind,
        });
      }
      // Providers fill gaps and add links. They never change the kind: disagreements go to a human instead.
      for (const link of result.links) if (!rule.links.some((l) => l.url === link.url)) rule.links.push(link);
      if (rule.conditions.length === 0) rule.conditions = [...result.conditions];
      if (rule.allowedDays === undefined && result.kind === rule.kind) rule.allowedDays = result.allowedDays;
      rule.sourceUpdatedAt ??= result.sourceUpdatedAt;
    }
  }

  const sorted = [...rules.values()]
    .map((r) => EntryRule.parse(r))
    .sort((a, b) =>
      a.context.localeCompare(b.context) || a.passport.localeCompare(b.passport) || a.destination.localeCompare(b.destination),
    );

  for (const rule of sorted) {
    const composed = ComposedEntryRule.safeParse(composeRule(rule, destinations[rule.destination], dataset.meta));
    if (!composed.success) {
      throw new Error(`${rule.passport}→${rule.destination}: ${composed.error.issues.map((i) => i.message).join("; ")}`);
    }
    report.rulesByOrigin[rule.origin] = (report.rulesByOrigin[rule.origin] ?? 0) + 1;
    report.rulesByKind[rule.kind] = (report.rulesByKind[rule.kind] ?? 0) + 1;
    if (rule.origin === "dataset" && demoRegion.has(rule.destination)) {
      report.unverifiedDemoPairs.push(`${rule.passport}→${rule.destination}`);
    }
    if (rule.verifiedAt) {
      report.curated.push({ key: `${rule.context} ${rule.passport}→${rule.destination}`, verifiedAt: rule.verifiedAt });
    }
  }

  return {
    data: { version: 1, dataset: dataset.meta, destinations, rules: sorted },
    report,
  };
}
