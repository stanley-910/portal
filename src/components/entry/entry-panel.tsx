import type { CSSProperties } from "react";

import { PixelIcon } from "@/components/paper-atlas";
import { PixelFlag } from "@/components/ticket-search/pixel-flag";
import { entry, hubCountry, isBlocking, needsDocument, type EntryKind, type EntryMember, type EntryRule, type LegEntryInput, type MemberLegEntry } from "@/lib/entry";
import { iso2, iso3 } from "@/lib/entry/iso";
import { countryName } from "@/lib/nationality";
import { cn } from "@/lib/utils";

// What each rider needs to get into a leg's destination, at a glance: their passport's flag, a chip, and at most one
// line under it. Opened beside a trip card from its passport button (EntryButton).

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

/** "Oct 2" */
const formatDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });

const chipText = (rule: EntryRule) => (rule.allowedDays ? `${KIND_LABEL[rule.kind]} · ${rule.allowedDays} days` : KIND_LABEL[rule.kind]);

/**
 * A rider, with whichever passports they've told us about (without one there's nothing to look up), and where they go
 * after this leg's destination, which can let them in on a transit exemption.
 */
export type EntryRider = Omit<EntryMember, "passport"> & { passport?: string | null; onwardCountry?: string | null };

/**
 * The one thing worth knowing beyond the chip, only for a rider who has something to do: the first condition, else a
 * transit hint, else when the rule ends. Visa free needs no line.
 */
function note({ rule, transitOption }: MemberLegEntry): string | null {
  if (!rule) return null;
  if (!transitOption && !isBlocking(rule) && !needsDocument(rule.kind)) return null;
  if (rule.conditions[0]) return rule.conditions[0];
  if (transitOption) return `${KIND_LABEL.transit_exempt} up to ${transitOption.allowedDays} days with an onward ticket.`;
  if (rule.until) return `Until ${formatDay(rule.until)}.`;
  return null;
}

function Chip({ rule }: { rule: EntryRule | null }) {
  if (!rule) return <span className="en-chip" data-tone="none">No border</span>;
  // anything the rider must act on prints solid, so whoever differs from the party stands out
  const act = isBlocking(rule) || needsDocument(rule.kind);
  return (
    <span className="en-chip" data-tone={rule.kind === "unknown" ? "unknown" : act ? "act" : "ok"}>
      {chipText(rule)}
    </span>
  );
}

function Row(r: MemberLegEntry) {
  const { member, passport, rule } = r;
  const line = note(r);
  const apply = rule && needsDocument(rule.kind) ? rule.links.find((l) => l.role === "apply") : undefined;
  const also = [member.passport, ...(member.passports ?? [])].filter((p) => p !== passport).map(countryName);
  return (
    <li className="en-row">
      <div className="en-head">
        <PixelFlag country={iso2(passport) ?? passport} />
        <span className="en-name" title={also.length ? `${countryName(passport)} passport (also holds ${also.join(", ")})` : `${countryName(passport)} passport`}>
          {member.name}
        </span>
        {rule?.freshness === "estimated" ? <span className="ts-badge ts-badge-quiet">Estimated</span> : null}
        <Chip rule={rule} />
      </div>
      {line || apply ? (
        <p className="en-note">
          {line}
          {apply ? (
            <>
              {line ? " " : null}
              <a href={apply.url} target="_blank" rel="noopener noreferrer">
                How to apply
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </li>
  );
}

export interface EntryPanelProps {
  leg: LegEntryInput;
  riders: EntryRider[];
  className?: string;
  style?: CSSProperties;
}

/** Each rider's entry rule for one leg, with the sources they came from. */
export function EntryPanel({ leg, riders, className, style }: EntryPanelProps) {
  const known = riders.filter((r): r is EntryMember & EntryRider => !!r.passport);
  const missing = riders.filter((r) => !r.passport);
  // each rider's own onward stop, so one going on to a third country gets the transit rule and one going home doesn't
  const rows = known.flatMap((r) => entry.getLegEntry({ ...leg, onwardCountry: r.onwardCountry ?? leg.onwardCountry }, [r]));
  const destination = rows.find((r) => r.rule)?.rule?.destination ?? iso3(leg.toCountry) ?? (leg.toHub ? hubCountry(leg.toHub) : undefined);
  const name = destination ? (entry.destinationName(destination) ?? countryName(destination)) : null;
  // every source once, however many riders it covers
  const sources = [...new Map(rows.flatMap((r) => r.rule?.links.filter((l) => l.role === "source") ?? []).map((l) => [l.url, l])).values()];

  return (
    <section aria-label={name ? `Entry requirements into ${name}` : "Entry requirements"} className={cn("en", className)} style={style}>
      <h3 className="ts-step">{name ? `Entry requirements into ${name}` : "Entry requirements"}</h3>
      {rows.length || missing.length ? (
        <ul className="en-list">
          {rows.map((r) => (
            <Row key={r.member.id} {...r} />
          ))}
          {missing.map((r) => (
            <li key={r.id} className="en-row">
              <div className="en-head">
                <PixelFlag country={null} />
                <span className="en-name">{r.name}</span>
                <span className="en-chip" data-tone="unknown">
                  No passport set
                </span>
              </div>
              <p className="en-note">Add it in the profile menu to see what’s needed.</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="en-note">Nobody’s riding this leg yet.</p>
      )}
      {rows.some((r) => r.rule) ? (
        <p className="en-foot">
          Rules change, so check before you go.
          {sources.length ? " Source: " : null}
          {sources.map((s, i) => (
            <span key={s.url}>
              {i ? " · " : null}
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.label}
              </a>
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}

// A passport in Pip's pixels: a plain navy cover with the gold e-passport chip mark centred on it.
// # cover · + gilt
const PASSPORT = [
  " ########## ",
  "############",
  "############",
  "##++++++++##",
  "##+++##+++##",
  "##++#++#++##",
  "#####++#####",
  "##++#++#++##",
  "##+++##+++##",
  "##++++++++##",
  "############",
  "############",
  " ########## ",
];

export function PassportIcon() {
  return <PixelIcon rows={PASSPORT} className="en-passport" />;
}
