// Travel Buddy visa API (RapidAPI). Cross-check and link fill only: its kind never overrides ours, it is
// reported as a disagreement instead. Free tier is 120-200 requests a month, so responses are cached for 30 days
// and the run refuses to start if it would exceed --max-requests.
// Docs: https://travel-buddy.ai/api/ — terms of use for the API are not yet reviewed; raw responses stay in the
// gitignored cache and only normalised official links are committed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { iso2 } from "../../../src/lib/entry/iso.ts";
import type { EntryKind, EntryLink, ProviderResult } from "../../../src/lib/entry/schema.ts";
import type { EntryProvider } from "./types.mts";

const ENDPOINT = "https://visa-requirement.p.rapidapi.com/v2/visa/check";
const HOST = "visa-requirement.p.rapidapi.com";
const CACHE_DAYS = 30;


interface Rule {
  name?: string;
  duration?: string;
  link?: string;
}

export interface TravelBuddyResponse {
  data?: {
    destination?: { passport_validity?: string; embassy_url?: string };
    mandatory_registration?: Rule;
    visa_rules?: { primary_rule?: Rule; secondary_rule?: Rule; exception_rule?: Rule };
  };
}

export function mapRuleName(name: string | undefined): EntryKind | undefined {
  const n = (name ?? "").toLowerCase();
  if (!n) return undefined;
  if (n.includes("not admitted") || n.includes("no admission")) return "no_admission";
  if (n.includes("visa-free") || n.includes("visa free") || n.includes("visa not required")) return "visa_free";
  if (n.includes("on arrival")) return "visa_on_arrival";
  if (n.includes("evisa") || n.includes("e-visa")) return "e_visa";
  if (/\beta\b|k-eta|etias/.test(n)) return "eta";
  if (n.includes("visa required")) return "visa_required";
  return undefined;
}

const days = (duration: string | undefined) => {
  const m = duration?.match(/(\d+)\s*day/i);
  return m ? Number(m[1]) : undefined;
};

/** Travel Buddy links go through its own redirector. Store the official destination, not the redirect. */
async function resolve(url: string): Promise<string> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual" });
    const location = res.headers.get("location");
    return location ? new URL(location, url).toString() : url;
  } catch {
    return url;
  }
}

export async function normalise(
  passport: string,
  destination: string,
  body: TravelBuddyResponse,
  resolveUrl: (url: string) => Promise<string> = resolve,
): Promise<ProviderResult> {
  const rules = body.data?.visa_rules ?? {};
  const links: EntryLink[] = [];
  const add = async (label: string | undefined, url: string | undefined, role: EntryLink["role"]) => {
    if (!url) return;
    const resolved = await resolveUrl(url);
    if (!links.some((l) => l.url === resolved)) links.push({ label: label ?? "More information", url: resolved, role });
  };
  await add(rules.secondary_rule?.name, rules.secondary_rule?.link, "apply");
  await add(body.data?.mandatory_registration?.name, body.data?.mandatory_registration?.link, "info");
  await add(rules.exception_rule?.name, rules.exception_rule?.link, "info");

  const conditions: string[] = [];
  const validity = body.data?.destination?.passport_validity;
  if (validity) conditions.push(`Passport validity: ${validity}`);
  const registration = body.data?.mandatory_registration?.name;
  if (registration) conditions.push(`${registration} before arrival`);

  return {
    passport,
    destination,
    kind: mapRuleName(rules.primary_rule?.name),
    allowedDays: days(rules.primary_rule?.duration),
    conditions,
    links,
  };
}

export const travelBuddyProvider: EntryProvider = {
  id: "travel-buddy",
  unavailable: () => (process.env.TRAVEL_BUDDY_API_KEY ? undefined : "TRAVEL_BUDDY_API_KEY is not set"),
  async run({ pairs, maxRequests, cacheDir, log }) {
    const dir = join(cacheDir, "travel-buddy");
    mkdirSync(dir, { recursive: true });
    const now = Date.now();

    const cached = (p: string, d: string): TravelBuddyResponse | undefined => {
      try {
        const entry = JSON.parse(readFileSync(join(dir, `${p}-${d}.json`), "utf8"));
        return now - Date.parse(entry.fetchedAt) < CACHE_DAYS * 86_400_000 ? entry.body : undefined;
      } catch {
        return undefined;
      }
    };

    // Travel Buddy takes ISO-2.
    const supported = pairs.filter((x) => iso2(x.passport) && iso2(x.destination));
    for (const x of pairs) if (!supported.includes(x)) log(`travel-buddy: no ISO-2 code for ${x.passport}→${x.destination}`);
    const toFetch = supported.filter((x) => !cached(x.passport, x.destination));
    if (toFetch.length > maxRequests) {
      throw new Error(
        `travel-buddy: ${toFetch.length} uncached pairs exceed --max-requests=${maxRequests}. Narrow data/entry/config.json or raise the limit.`,
      );
    }
    log(`travel-buddy: ${supported.length - toFetch.length} cached, ${toFetch.length} to fetch`);

    for (const { passport, destination } of toFetch) {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RapidAPI-Key": process.env.TRAVEL_BUDDY_API_KEY!,
          "X-RapidAPI-Host": HOST,
        },
        body: JSON.stringify({ passport: iso2(passport), destination: iso2(destination) }),
      });
      if (!res.ok) throw new Error(`travel-buddy: ${passport}→${destination} returned ${res.status}`);
      const body = (await res.json()) as TravelBuddyResponse;
      writeFileSync(join(dir, `${passport}-${destination}.json`), JSON.stringify({ fetchedAt: new Date(now).toISOString(), body }));
    }

    return Promise.all(supported.map((x) => normalise(x.passport, x.destination, cached(x.passport, x.destination) ?? {})));
  },
};
