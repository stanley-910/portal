// What Pip's check_entry tools return, in a trip room (tools.ts) and on the home globe (solo.ts): the rule for every
// passport a person holds on one leg, never just the easiest, so Pip can say which passport each answer is for.
import { entry, hubCountry, type EntryKind, type EntryLink, type EntryRule, type PassportLegEntry } from "@/lib/entry";
import { iso3 } from "@/lib/entry/iso";
import { countryName } from "@/lib/nationality";
import type { Stop } from "@/lib/liveblocks/types";
import { HUBS } from "@/lib/transport/hubs/catalog";
import { distanceKm } from "@/lib/transport/hubs/geo";
import type { Hub } from "@/lib/transport/hubs/types";

export const OFFICIAL_ENTRY_REMINDER = "Check official government sources before travelling.";

type Where = Pick<Stop, "lat" | "lng" | "hub"> & { code?: string | null };

const BY_ID = new Map(HUBS.map((h) => [h.id, h]));
/** A city Pip placed by name sits on its main hub's point; a click this close to a hub is in that hub's country. */
const SAME_PLACE_KM = 5;

/**
 * The country a stop is in (ISO-3) and its airport code, for entry rules. A stop's `hub` is a catalog ID such as
 * "airport:PVG" or "train:HK-WEST-KOWLOON", not an IATA code. Country is undefined when nothing places the stop.
 */
export function stopBorder(stop: Where): { country?: string; iata?: string } {
  const atHub = (h: Hub) => ({ country: iso3(h.country), iata: h.mode === "flight" ? h.iata ?? h.code : undefined });
  const hub = stop.hub ? BY_ID.get(stop.hub) : undefined;
  if (hub) return atHub(hub);
  for (const code of [stop.hub, stop.code]) {
    const country = code ? hubCountry(code) : undefined;
    if (country) return { country, iata: code!.toUpperCase() };
  }
  let near: Hub | undefined;
  let best = SAME_PLACE_KM;
  for (const h of HUBS) {
    const d = distanceKm(stop, h);
    if (d <= best) [near, best] = [h, d];
  }
  return near ? atHub(near) : {};
}

/** A rule's facts, as the model should quote them. */
type RuleFacts = {
  requirement: EntryKind;
  allowedDays: number | null;
  /** Last day a temporary scheme runs. */
  until: string | null;
  conditions: string[];
  note: string | null;
  sources: Pick<EntryLink, "label" | "url" | "role">[];
  /** "cached" is hand-checked against an official source; "estimated" is from the Passport Index dataset alone. */
  freshness: EntryRule["freshness"];
  /** The day it was checked against the source, or the dataset's snapshot date. */
  checked: string | null;
};

export type PassportEntry = {
  passport: string;
  country: string;
  /** The passport that gets them in most easily. Exactly one per person. */
  easiest: boolean;
  /** "own_country" when this passport is the destination's own. */
  requirement: EntryKind | "own_country";
  allowedDays?: number | null;
  until?: string | null;
  conditions?: string[];
  note?: string | null;
  ports?: string[];
  sources?: RuleFacts["sources"];
  freshness?: RuleFacts["freshness"];
  checked?: string | null;
  /** True when their onward leg qualifies them for the transit exemption, and the facts above are that exemption. */
  usesTransit: boolean;
  /** A transit exemption this passport could use with an onward ticket to a third country. */
  transitOption?: RuleFacts & { ports: string[] | null };
  /** One line to quote: "United States passport: needs a visa before travelling." */
  says: string;
};

export type LegEntryAnswer =
  | { crossesBorder: false; note: string }
  | { crossesBorder: null; refused: "UNKNOWN_COUNTRY"; reason: string; next: string }
  | {
      crossesBorder: true;
      destination: string;
      passports: PassportEntry[];
      easiest: string;
      /** True when the passports don't all need the same thing. */
      passportsDiffer: boolean;
      summary: string;
      note: string;
    };

const facts = (r: EntryRule): RuleFacts => ({
  requirement: r.kind,
  allowedDays: r.allowedDays ?? null,
  until: r.until ?? null,
  conditions: r.conditions,
  note: r.note ?? null,
  sources: r.links.map(({ label, url, role }) => ({ label, url, role })),
  freshness: r.freshness,
  checked: r.verifiedAt ?? r.sourceUpdatedAt ?? r.datasetSnapshot ?? null,
});

const PHRASE: Record<EntryKind | "own_country", string> = {
  visa_free: "visa-free",
  transit_exempt: "visa-free transit",
  visa_on_arrival: "visa on arrival",
  eta: "needs an electronic travel authorisation (ETA) before travelling",
  e_visa: "needs an e-visa before travelling",
  entry_permit: "needs an entry permit (not a visa)",
  visa_required: "needs a visa before travelling",
  no_admission: "not admitted",
  unknown: "no data; check the official source",
  own_country: "own country, no visa needed",
};

function says(row: PassportEntry): string {
  const days = row.allowedDays ? ` for up to ${row.allowedDays} days` : "";
  const until = row.until ? ` (the scheme runs until ${row.until})` : "";
  const estimated = row.freshness === "estimated" ? " [estimated]" : "";
  const transit = !row.usesTransit && row.transitOption
    ? `; or visa-free transit for up to ${row.transitOption.allowedDays ?? "?"} days with an onward ticket to a third country`
    : "";
  return `${row.country} passport: ${PHRASE[row.requirement]}${days}${until}${transit}${estimated}.`;
}

function toPassportEntry(row: PassportLegEntry): PassportEntry {
  const base = { passport: row.passport, country: countryName(row.passport), easiest: row.easiest, usesTransit: row.usesTransit };
  const out: PassportEntry = row.rule
    ? { ...base, ...facts(row.rule), ...(row.rule.ports && { ports: row.rule.ports }), says: "" }
    : { ...base, requirement: "own_country", says: "" };
  if (row.transitOption) out.transitOption = { ...facts(row.transitOption), ports: row.transitOption.ports ?? null };
  out.says = says(out);
  return out;
}

/**
 * Entry on one leg for every passport someone holds. `onward` is where they go next, which decides whether a transit
 * exemption applies. Passports should be non-empty; the caller says when none are recorded.
 */
export function legEntry(from: Where | undefined, to: Where, passports: string[], onward?: Where): LegEntryAnswer {
  const a = from ? stopBorder(from) : {};
  const b = stopBorder(to);
  if (!b.country) {
    return {
      crossesBorder: null,
      refused: "UNKNOWN_COUNTRY",
      reason: "I can't tell which country that stop is in.",
      next: "Say so, name the place, and point them to the destination's official immigration site.",
    };
  }
  if (a.country === b.country) return { crossesBorder: false, note: `No border: both ends are in ${countryName(b.country)}.` };

  const rows = entry
    .resolvePassports({ fromCountry: a.country, toCountry: b.country, toHub: b.iata, onwardCountry: onward ? stopBorder(onward).country : undefined }, passports)
    .map(toPassportEntry);
  const best = rows.find((r) => r.easiest)!;
  const passportsDiffer = new Set(rows.map((r) => `${r.requirement}:${r.usesTransit}`)).size > 1;
  return {
    crossesBorder: true,
    destination: entry.destinationName(b.country) ?? countryName(b.country),
    passports: rows,
    easiest: best.country,
    passportsDiffer,
    summary: `${rows.map((r) => r.says).join(" ")}${rows.length > 1 ? ` Easiest: the ${best.country} passport.` : ""}`,
    note: `Name the passport each requirement applies to.${passportsDiffer ? " The passports differ: say which one needs a visa or document and which doesn't." : ""} Call only [estimated] rows estimates; the rest were checked against the official source linked. ${OFFICIAL_ENTRY_REMINDER}`,
  };
}
