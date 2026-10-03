// The passports someone holds, as ISO-3 codes ("USA", "CAN"). Several are allowed: entry rules differ by passport,
// so a dual national can travel on whichever one gets them in more easily. Safe on the client and the server.
import { iso2, iso3 } from "@/lib/entry/iso";

// Fixed English names, so the server and the browser print the same thing (their Intl data differs: "Hong Kong SAR
// China" on one, "Hong Kong" on the other). Keyed by ISO-3 for every country in the entry data.
import COUNTRY_NAMES from "./country-names.json" with { type: "json" };

const NAMES: Record<string, string> = COUNTRY_NAMES;

export const MAX_NATIONALITIES = 4;

/** Valid, distinct ISO-3 codes from an array or a comma-separated string, in order, at most MAX_NATIONALITIES. */
export function parseNationalities(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const out: string[] = [];
  for (const item of list) {
    const code = typeof item === "string" ? iso3(item) : undefined;
    if (code && !out.includes(code)) out.push(code);
    if (out.length === MAX_NATIONALITIES) break;
  }
  return out;
}

/** The country's flag as an emoji, from its two regional-indicator letters. Empty for an unknown code. */
export function flagEmoji(code: string): string {
  const two = iso2(code);
  return two ? String.fromCodePoint(...[...two].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "";
}

/** "United States", "Hong Kong". Falls back to the code. */
export function countryName(code: string): string {
  const three = iso3(code);
  return (three && NAMES[three]) || code;
}

let all: { code: string; name: string }[] | null = null;

/** Every country the entry data knows, by name. */
export function countries() {
  all ??= Object.entries(NAMES)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  return all;
}
