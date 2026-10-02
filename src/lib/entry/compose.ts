// Turns a stored rule into what the UI and API show: dataset attribution plus per-destination official links.
// Kept out of the generated JSON so the file stays small and destination links live in one place.
import type { DatasetMeta, Destination, EntryContext, EntryKind, EntryLink, EntryRule } from "./schema.ts";

/** Kinds where the traveller must get a document before going, so a "How to apply" link matters. */
const NEEDS_DOCUMENT: ReadonlySet<EntryKind> = new Set(["eta", "e_visa", "entry_permit", "visa_required"]);

export const needsDocument = (kind: EntryKind) => NEEDS_DOCUMENT.has(kind);

/** Kinds that stop the trip unless the member already holds the document. Permits are common enough not to block. */
export const isBlocking = (rule: Pick<EntryRule, "kind">) => rule.kind === "visa_required" || rule.kind === "no_admission";

export function unknownRule(passport: string, destination: string, context: EntryContext = "entry"): EntryRule {
  return {
    passport,
    destination,
    context,
    kind: "unknown",
    conditions: [],
    links: [],
    origin: "none",
    freshness: "estimated",
  };
}

/** Skips a link that repeats a URL, or names an agency already linked (a deep source beats its home page). */
function addLinks(into: EntryLink[], more: EntryLink[]) {
  for (const link of more) if (!into.some((l) => l.url === link.url || l.label === link.label)) into.push(link);
}

export function composeRule(rule: EntryRule, destination: Destination | undefined, dataset: DatasetMeta): EntryRule {
  const links: EntryLink[] = [];
  if (rule.origin === "dataset") {
    links.push({ label: "Passport Index dataset", url: dataset.repo, role: "source" });
  }
  addLinks(links, rule.links);

  for (const { for: kinds, ...link } of destination?.links ?? []) {
    if (link.role === "apply") {
      const fits = kinds ? kinds.includes(rule.kind) : needsDocument(rule.kind);
      if (fits && !links.some((l) => l.role === "apply")) addLinks(links, [link]);
    } else if (!kinds || kinds.includes(rule.kind)) {
      addLinks(links, [link]);
    }
  }
  return { ...rule, links };
}
