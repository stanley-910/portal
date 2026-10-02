import type { CSSProperties } from "react";

import { entry, isBlocking, needsDocument, type EntryKind, type EntryMember, type EntryRule, type LegEntryInput, type MemberLegEntry } from "@/lib/entry";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<EntryKind, string> = {
  visa_free: "Visa free",
  visa_on_arrival: "Visa on arrival",
  eta: "eTA needed",
  e_visa: "e-visa needed",
  entry_permit: "Permit needed",
  visa_required: "Visa required",
  transit_exempt: "Visa-free transit",
  no_admission: "No entry",
  unknown: "No data",
};

/** "2 Oct 2026" */
const formatDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const chipText = (rule: EntryRule) =>
  rule.allowedDays ? `${KIND_LABEL[rule.kind]} · ${rule.allowedDays} days` : KIND_LABEL[rule.kind];

/** Where the rule came from and how old it is. Every rule says "check official sources", however it was sourced. */
function provenance(rule: EntryRule): string {
  const parts: string[] = [];
  if (rule.verifiedAt) parts.push(`Verified ${formatDay(rule.verifiedAt)}`);
  else if (rule.datasetSnapshot) parts.push(`Dataset ${formatDay(rule.datasetSnapshot)}`);
  if (rule.sourceUpdatedAt) parts.push(`GOV.UK updated ${formatDay(rule.sourceUpdatedAt)}`);
  parts.push("Check official sources");
  return parts.join(" · ");
}

function EntryChip({ rule }: { rule: EntryRule | null }) {
  if (!rule) return <span className="type-tag text-ink-muted">Home</span>;
  // Anything the member must act on is printed solid, so a member who differs from the party stands out.
  const act = isBlocking(rule) || needsDocument(rule.kind);
  return (
    <span
      className={cn(
        "type-tag inline-flex h-7 items-center rounded-tag border border-ink px-2",
        act ? "bg-ink text-paper-raised" : "bg-paper-raised text-ink",
        rule.kind === "unknown" && "border-dashed text-ink-muted",
      )}
    >
      {chipText(rule)}
    </span>
  );
}

function EstimatedBadge() {
  return <span className="type-meta rounded-tag border border-dashed border-ink px-1 text-ink-muted">Estimated</span>;
}

function LinkList({ rule }: { rule: EntryRule }) {
  const source = rule.links.filter((l) => l.role === "source");
  const apply = rule.links.find((l) => l.role === "apply");
  const info = rule.links.filter((l) => l.role === "info" || l.role === "embassy");
  const items = [
    ...source.map((l) => ({ ...l, prefix: "Source" })),
    ...(apply && needsDocument(rule.kind) ? [{ ...apply, prefix: "How to apply" }] : []),
    ...info.map((l) => ({ ...l, prefix: "More" })),
  ];
  if (!items.length) return null;
  return (
    <ul className="flex flex-col gap-(--space-1)">
      {items.map((l) => (
        <li key={l.url} className="type-meta">
          <span className="text-ink-muted">{l.prefix}: </span>
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus"
          >
            {l.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

function MemberRow({ member, rule, transitOption }: MemberLegEntry) {
  const body = rule ? (
    <div className="flex flex-col gap-(--space-2) pt-(--space-2) pb-(--space-1)">
      {rule.conditions.length ? (
        <ul className="type-meta flex list-disc flex-col gap-(--space-1) pl-4 text-ink">
          {rule.conditions.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
      {rule.until ? <p className="type-meta text-ink">Until {formatDay(rule.until)}</p> : null}
      {transitOption ? (
        <p className="type-meta text-ink">
          {KIND_LABEL.transit_exempt} for up to {transitOption.allowedDays} days with an onward ticket to a third country.
        </p>
      ) : null}
      <LinkList rule={rule} />
      {transitOption ? <LinkList rule={transitOption} /> : null}
      <p className="type-meta text-ink-muted">{provenance(rule)}</p>
    </div>
  ) : null;

  const summary = (
    <span className="flex min-h-11 items-center justify-between gap-(--space-3)">
      <span className="type-body text-ink">{member.name}</span>
      <span className="flex items-center gap-(--space-2)">
        {rule && rule.freshness === "estimated" ? <EstimatedBadge /> : null}
        <EntryChip rule={rule} />
      </span>
    </span>
  );

  if (!body) return <li className="px-(--space-3)">{summary}</li>;
  return (
    <li className="px-(--space-3)">
      <details className="group">
        <summary className="cursor-pointer list-none rounded-tag focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
          {summary}
        </summary>
        {body}
      </details>
    </li>
  );
}

export interface EntryPanelProps {
  leg: LegEntryInput;
  members: EntryMember[];
  className?: string;
  style?: CSSProperties;
}

/** Per-member entry rules for one leg: what each passport needs at the destination, with sources. */
export function EntryPanel({ leg, members, className, style }: EntryPanelProps) {
  const rows = entry.getLegEntry(leg, members);
  if (rows.every((r) => r.rule === null)) return null;

  const destination = rows.find((r) => r.rule)?.rule?.destination;
  const name = destination ? (entry.destinationName(destination) ?? destination) : undefined;

  return (
    <section
      aria-label={name ? `Entry to ${name}` : "Entry"}
      className={cn("w-[min(360px,calc(100vw-32px))] rounded-ticket border border-ink bg-paper-raised py-(--space-2) shadow-ticket", className)}
      style={style}
    >
      {name ? <h2 className="type-stamp px-(--space-3) pb-(--space-1) text-ink">Entry · {name}</h2> : null}
      <ul className="flex flex-col divide-y divide-rule">
        {rows.map((r) => (
          <MemberRow key={r.member.id} {...r} />
        ))}
      </ul>
    </section>
  );
}
