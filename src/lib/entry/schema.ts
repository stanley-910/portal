// Entry requirements: shared by the build script (scripts/entry-requirements.mts), the runtime lookup and the API.
// Imports use explicit .ts extensions so Node can run this file directly.
import { z } from "zod";

/** ISO 3166-1 alpha-3, plus the territory codes the dataset uses (HKG, MAC, TWN). */
export const CountryCode = z.string().regex(/^[A-Z]{3}$/, "Expected a three-letter ISO code");

export const EntryKind = z.enum([
  "visa_free",
  "visa_on_arrival",
  "eta",
  "e_visa",
  /** A non-visa travel document, e.g. Home Return Permit for HK → mainland, EEP for mainland → HK. */
  "entry_permit",
  "visa_required",
  "transit_exempt",
  "no_admission",
  "unknown",
]);
export type EntryKind = z.infer<typeof EntryKind>;

/** "entry" is a normal visit. "transit" rules only apply when the member continues to a third country. */
export const EntryContext = z.enum(["entry", "transit"]);
export type EntryContext = z.infer<typeof EntryContext>;

export const LinkRole = z.enum(["source", "apply", "embassy", "info"]);

export const EntryLink = z.object({
  label: z.string().min(1),
  url: z.url(),
  role: LinkRole,
});
export type EntryLink = z.infer<typeof EntryLink>;

export const EntryOrigin = z.enum(["curated", "dataset", "provider", "none"]);
export const Freshness = z.enum(["live", "cached", "estimated"]);
export type Freshness = z.infer<typeof Freshness>;

const IsoDate = z.iso.date();

export const EntryRule = z
  .object({
    passport: CountryCode,
    destination: CountryCode,
    context: EntryContext.default("entry"),
    kind: EntryKind,
    allowedDays: z.number().int().positive().optional(),
    /** Last day a temporary policy applies, e.g. China's unilateral visa-free scheme. */
    until: IsoDate.optional(),
    conditions: z.array(z.string().min(1)).default([]),
    /** Hub codes where a transit rule is known to apply. Absent means "not port-specific". */
    ports: z.array(z.string()).optional(),
    note: z.string().optional(),
    links: z.array(EntryLink).default([]),
    origin: EntryOrigin,
    freshness: Freshness,
    /** Set only on hand-curated rules: the day someone checked the official source. */
    verifiedAt: IsoDate.optional(),
    /** A provider's own date for its content, e.g. GOV.UK's last update. */
    sourceUpdatedAt: IsoDate.optional(),
    /** Snapshot date of the dataset a dataset-origin rule came from. */
    datasetSnapshot: IsoDate.optional(),
  })
  .refine((r) => (r.origin === "curated") === (r.verifiedAt !== undefined), {
    message: "verifiedAt is required on curated rules and forbidden on others",
    path: ["verifiedAt"],
  });
export type EntryRule = z.infer<typeof EntryRule>;

/** A rule after lookup has attached dataset and destination links. Every non-unknown rule has a source. */
export const ComposedEntryRule = EntryRule.refine(
  (r) => r.kind === "unknown" || r.links.some((l) => l.role === "source"),
  { message: "A rule needs at least one source link", path: ["links"] },
);

/** Hand-written override in data/entry/curated/*.json. `passports` expands into one rule per passport. */
export const CuratedEntry = z
  .object({
    passport: CountryCode.optional(),
    passports: z.array(CountryCode).min(1).optional(),
    destination: CountryCode,
    context: EntryContext.default("entry"),
    kind: EntryKind.exclude(["unknown"]),
    allowedDays: z.number().int().positive().optional(),
    until: IsoDate.optional(),
    conditions: z.array(z.string().min(1)).default([]),
    ports: z.array(z.string()).optional(),
    note: z.string().optional(),
    links: z.array(EntryLink).min(1),
    verifiedAt: IsoDate,
  })
  .refine((c) => (c.passport === undefined) !== (c.passports === undefined), {
    message: "Give exactly one of passport or passports",
  })
  .refine((c) => c.links.some((l) => l.role === "source"), {
    message: "Curated entries need an official source link",
    path: ["links"],
  });
export type CuratedEntry = z.infer<typeof CuratedEntry>;

/** Per-destination links in data/entry/destinations.json. `for` limits an apply link to the kinds it serves. */
export const DestinationLink = EntryLink.extend({ for: z.array(EntryKind).optional() });
export type DestinationLink = z.infer<typeof DestinationLink>;

export const Destination = z.object({
  code: CountryCode,
  name: z.string().min(1),
  /** Slug on gov.uk/foreign-travel-advice. Absent for the UK itself. */
  govukSlug: z.string().optional(),
  links: z.array(DestinationLink).default([]),
});
export type Destination = z.infer<typeof Destination>;

/** What a build-time provider contributes for one pair. Never shipped raw to the client. */
export const ProviderResult = z.object({
  passport: CountryCode,
  destination: CountryCode,
  kind: EntryKind.optional(),
  allowedDays: z.number().int().positive().optional(),
  conditions: z.array(z.string()).default([]),
  links: z.array(EntryLink).default([]),
  sourceUpdatedAt: IsoDate.optional(),
});
export type ProviderResult = z.infer<typeof ProviderResult>;

/** Normalised provider output, committed at data/entry/providers/<id>.json so plain builds stay offline. */
export const ProviderSnapshot = z.object({
  provider: z.string(),
  fetchedAt: IsoDate,
  results: z.array(ProviderResult),
});
export type ProviderSnapshot = z.infer<typeof ProviderSnapshot>;

export const DatasetMeta = z.object({
  name: z.string(),
  repo: z.url(),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  snapshotDate: IsoDate,
  licence: z.string(),
});
export type DatasetMeta = z.infer<typeof DatasetMeta>;

/** The generated file, src/data/entry-requirements.json. */
export const EntryData = z.object({
  version: z.literal(1),
  dataset: DatasetMeta,
  destinations: z.record(z.string(), Destination),
  rules: z.array(EntryRule),
});
export type EntryData = z.infer<typeof EntryData>;
