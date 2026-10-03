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

// What people type that isn't a country's name or code.
const ALIASES: Record<string, string[]> = {
  USA: ["america", "us", "united states of america"],
  GBR: ["uk", "britain", "great britain", "england", "scotland", "wales"],
  KOR: ["korea", "south korea"],
  PRK: ["north korea"],
  NLD: ["holland"],
  CHN: ["prc", "mainland china"],
  TWN: ["roc"],
  ARE: ["uae", "emirates"],
  CZE: ["czech republic"],
  TUR: ["turkey", "türkiye"],
};

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** How well `query` matches `text`, higher is better; 0 for no match. Prefixes beat word starts beat letters in order. */
function score(query: string, text: string): number {
  if (text === query) return 100;
  if (text.startsWith(query)) return 80 - text.length / 100;
  if (text.split(/[\s-]+/).some((w) => w.startsWith(query))) return 60 - text.length / 100;
  if (text.includes(query)) return 40;
  // the letters in order, closer together is better: "nzl" finds "new zealand"
  let at = -1;
  let gaps = 0;
  for (const ch of query) {
    const next = text.indexOf(ch, at + 1);
    if (next < 0) return 0;
    if (at >= 0) gaps += next - at - 1;
    at = next;
  }
  return Math.max(1, 20 - gaps);
}

/** Countries matching a typed query, best first, by name, ISO-2 and ISO-3 code, or a common alias. Empty query: all. */
export function searchCountries(query: string): { code: string; name: string }[] {
  const q = fold(query.trim());
  if (!q) return countries();
  const scored: { c: { code: string; name: string }; s: number }[] = [];
  for (const c of countries()) {
    const keys = [fold(c.name), c.code.toLowerCase(), (iso2(c.code) ?? "").toLowerCase(), ...(ALIASES[c.code] ?? [])];
    // a code only counts as a whole match, so "can" finds Canada, not every name with "can" in it twice
    const s = Math.max(...keys.map((k, i) => (i === 1 || i === 2 ? (k === q ? 90 : 0) : score(q, k))));
    if (s > 0) scored.push({ c, s });
  }
  return scored.sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name, "en")).map((x) => x.c);
}
