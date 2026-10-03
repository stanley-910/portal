// Runtime entry lookup over the generated file. No network: the data is built by scripts/entry-requirements.mts.
import { composeRule, isBlocking, unknownRule } from "./compose.ts";
import { hubCountry } from "./hub-countries.ts";
import { iso3 } from "./iso.ts";
import type { EntryContext, EntryData, EntryRule } from "./schema.ts";

export interface EntryMember {
  id: string;
  name: string;
  /** Passport country, ISO-3 or ISO-2: "HKG" or "HK" for an HKSAR passport. */
  passport: string;
  /** Other passports they hold. Each leg uses whichever passport gets them in most easily. */
  passports?: string[];
}

/**
 * The parts of a leg that matter for entry. Countries take ISO-3 or ISO-2, so a transport `Place.country` works as
 * is. Pass hub (IATA) codes instead and the country is resolved for you.
 */
export interface LegEntryInput {
  fromHub?: string;
  toHub?: string;
  fromCountry?: string;
  toCountry?: string;
  /** Where the member goes after this destination. Enables transit rules when it is a third country. */
  onwardCountry?: string;
}

export interface LegEntry {
  /** The rule that applies. Null when this leg crosses no border for the member. */
  rule: EntryRule | null;
  /** True when the member qualifies for a transit exemption on this leg and `rule` is that exemption. */
  usesTransit: boolean;
  /** A transit exemption the member could use with a different itinerary, shown as a hint. */
  transitOption?: EntryRule;
}

export interface MemberLegEntry extends LegEntry {
  member: EntryMember;
  /** The passport this leg uses, ISO-3: the easiest one when the member holds several. */
  passport: string;
}

export interface EntryLookup {
  getRule(passport: string, destination: string, context?: EntryContext): EntryRule;
  resolveLeg(leg: LegEntryInput, passport: string): LegEntry;
  getLegEntry(leg: LegEntryInput, members: EntryMember[]): MemberLegEntry[];
  destinationName(code: string): string | undefined;
  data: EntryData;
}

// How hard a leg is to enter, lowest first, for picking between passports. No border at all is easiest. A passport
// we have no data for never beats a known rule, only a refusal.
const EASE: Record<EntryRule["kind"], number> = {
  visa_free: 1,
  transit_exempt: 2,
  visa_on_arrival: 3,
  eta: 4,
  e_visa: 5,
  entry_permit: 6,
  visa_required: 7,
  unknown: 8,
  no_admission: 9,
};
const ease = (leg: LegEntry) => (leg.rule ? EASE[leg.rule.kind] : 0);

export function createEntryLookup(data: EntryData): EntryLookup {
  const byKey = new Map(data.rules.map((r) => [`${r.context}:${r.passport}:${r.destination}`, r]));

  const find = (passport: string, destination: string, context: EntryContext) => {
    const rule = byKey.get(`${context}:${iso3(passport)}:${iso3(destination)}`);
    return rule && composeRule(rule, data.destinations[rule.destination], data.dataset);
  };

  const getRule = (passport: string, destination: string, context: EntryContext = "entry") =>
    find(passport, destination, context) ??
    unknownRule(iso3(passport) ?? passport.toUpperCase(), iso3(destination) ?? destination.toUpperCase(), context);

  const resolveLeg = (leg: LegEntryInput, passport: string): LegEntry => {
    const from = iso3(leg.fromCountry) ?? (leg.fromHub ? hubCountry(leg.fromHub) : undefined);
    const to = iso3(leg.toCountry) ?? (leg.toHub ? hubCountry(leg.toHub) : undefined);
    const holder = iso3(passport);
    if (!to) return { rule: null, usesTransit: false };
    if (to === from || to === holder) return { rule: null, usesTransit: false };

    const entry = getRule(passport, to);
    const transit = find(passport, to, "transit");
    if (!transit || (!isBlocking(entry) && entry.kind !== "e_visa" && entry.kind !== "unknown")) {
      return { rule: entry, usesTransit: false };
    }

    const portOk = !transit.ports || !leg.toHub || transit.ports.includes(leg.toHub.toUpperCase());
    const onward = iso3(leg.onwardCountry);
    const thirdCountry = onward !== undefined && onward !== to && onward !== from;
    if (portOk && thirdCountry) return { rule: transit, usesTransit: true };
    return { rule: entry, usesTransit: false, transitOption: transit };
  };

  return {
    data,
    getRule,
    resolveLeg,
    getLegEntry: (leg, members) =>
      members.map((member) => {
        const held = [member.passport, ...(member.passports ?? [])].map((p) => iso3(p) ?? p.toUpperCase());
        let best: { passport: string; leg: LegEntry } | null = null;
        for (const passport of new Set(held)) {
          const leg_ = resolveLeg(leg, passport);
          if (!best || ease(leg_) < ease(best.leg)) best = { passport, leg: leg_ };
        }
        return { member, passport: best!.passport, ...best!.leg };
      }),
    destinationName: (code) => data.destinations[iso3(code) ?? ""]?.name,
  };
}
