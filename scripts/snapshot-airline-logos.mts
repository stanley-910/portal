// Snapshots Duffel's airline list into src/lib/transport/airline-logos.json: the IATA codes of airlines with a
// square logo, and the URL template for it. Run: `pnpm airlines:snapshot` (needs DUFFEL_ACCESS_TOKEN in .env.local).
// Never runs at request time: the browser only loads the logo images from assets.duffel.com.
//
// Source: `GET /air/airlines` (Duffel-Version v2), paged with `limit` 200 and the `after` cursor.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const API = "https://api.duffel.com/air/airlines";
const OUT = fileURLToPath(new URL("../src/lib/transport/airline-logos.json", import.meta.url));
const token = process.env.DUFFEL_ACCESS_TOKEN;
if (!token) throw new Error("DUFFEL_ACCESS_TOKEN is not set");

interface Airline { iata_code: string | null; name: string; logo_symbol_url: string | null }
interface Page { data: Airline[]; meta: { after: string | null } }

const airlines: Airline[] = [];
let after: string | null = null;
do {
  const url = new URL(API);
  url.searchParams.set("limit", "200");
  if (after) url.searchParams.set("after", after);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Duffel-Version": "v2", Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Duffel returned ${response.status}`);
  const page = (await response.json()) as Page;
  airlines.push(...page.data);
  after = page.meta.after;
} while (after);

// Every logo so far sits at the same path, so the snapshot keeps only the codes; a logo elsewhere fails the run.
const TEMPLATE = "https://assets.duffel.com/img/airlines/for-light-background/full-color-logo/{code}.svg";
const codes = new Set<string>();
for (const a of airlines) {
  const code = a.iata_code?.toUpperCase();
  if (!code || !/^[A-Z0-9]{2}$/.test(code) || !a.logo_symbol_url) continue;
  if (a.logo_symbol_url !== TEMPLATE.replace("{code}", code)) throw new Error(`${code}: logo at ${a.logo_symbol_url}`);
  codes.add(code);
}
const snapshot = { template: TEMPLATE, codes: [...codes].sort() };
writeFileSync(OUT, JSON.stringify(snapshot).replace(/,"codes":/, ',\n"codes":').replace(/\]\}$/, "]}\n"));
console.log(`${airlines.length} airlines, ${codes.size} with a logo -> ${OUT}`);
