import type { Price } from "../../types";
import faresJson from "./fares.json";

// Published fares for timetabled trains: a standard seat, one adult, one way. Built from the captured fare tables by
// scripts/rail/fares.py. A published fare isn't a quote: seats, seasons and discounts aren't checked.

interface FareTable {
  id: string;
  currency: string;
  seat: string;
  country: string;
  operators: string[];
  source: string;
  retrievedAt: string;
  note: string;
  /** The fares are for one line (a shinkansen): a train that calls anywhere off it is another service. */
  lineOnly: boolean;
  /** Every name a station goes by, normalised, to its rail-cache station id. */
  names: Record<string, string>;
  /** "idA|idB" (sorted) to the fare; several when routes between them cost differently. */
  prices: Record<string, { price: number; via?: string[] }[]>;
}

const TABLES = (faresJson as unknown as { tables: FareTable[] }).tables;

export interface PublishedFare {
  price: Price;
  /** "Published standard car fare (THSR, retrieved 2026-10-03): <url>" */
  note: string;
}

const norm = (name: string) => name.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");

function tableFor(country: string | undefined, operator: string | undefined): FareTable | undefined {
  if (!operator) return undefined;
  return TABLES.find((t) => (!country || t.country === country) && t.operators.some((o) => operator === o || operator.startsWith(`${o}-`)));
}

/**
 * The published fare for a train between two stations, by name, or null when no table covers it. `calls` are the
 * names of the stations the train calls at, which pick the route where routes differ in price; without them, or
 * when none matches, the cheapest route's fare is used.
 */
export function publishedFare(
  { country, operator, from, to, calls = [] }: { country?: string; operator?: string; from: string[]; to: string[]; calls?: string[] },
): PublishedFare | null {
  const table = tableFor(country, operator);
  if (!table) return null;
  const id = (names: string[]) => names.map((n) => table.names[norm(n)]).find(Boolean);
  const a = id(from), b = id(to);
  if (!a || !b || a === b) return null;
  const options = table.prices[[a, b].sort().join("|")];
  if (!options?.length) return null;
  const stops = new Set(calls.map((n) => table.names[norm(n)]).filter(Boolean));
  if (table.lineOnly && calls.some((n) => !table.names[norm(n)])) return null;
  const fits = options.filter((o) => (o.via ?? []).every((v) => stops.has(v)));
  const pick = (fits.length ? fits : options).reduce((best, o) =>
    fits.length ? ((o.via?.length ?? 0) > (best.via?.length ?? 0) ? o : best) : (o.price < best.price ? o : best));
  return {
    price: { amount: pick.price, currency: table.currency },
    note: `Published ${table.seat} fare, retrieved ${table.retrievedAt}${table.note ? ` (${table.note})` : ""}: ${table.source}. Seats not checked.`,
  };
}
