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
}

export interface EntryLookup {
  getRule(passport: string, destination: string, context?: EntryContext): EntryRule;
  resolveLeg(leg: LegEntryInput, passport: string): LegEntry;
  getLegEntry(leg: LegEntryInput, members: EntryMember[]): MemberLegEntry[];
  destinationName(code: string): string | undefined;
  data: EntryData;
}

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
    getLegEntry: (leg, members) => members.map((member) => ({ member, ...resolveLeg(leg, member.passport) })),
    destinationName: (code) => data.destinations[iso3(code) ?? ""]?.name,
  };
}
