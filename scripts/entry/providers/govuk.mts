// GOV.UK foreign travel advice: official entry requirements for British passport holders only.
// Contributes a dated source link per destination, never a kind: FCDO publishes prose, not structured rules.
// Content is Open Government Licence v3; we link out instead of copying it.
import type { ProviderResult } from "../../../src/lib/entry/schema.ts";
import type { EntryProvider } from "./types.mts";

const INDEX = "https://www.gov.uk/api/content/foreign-travel-advice";

interface IndexChild {
  public_updated_at: string;
  details: { country: { slug: string } };
}

export const govukProvider: EntryProvider = {
  id: "govuk",
  async run({ pairs, destinations, log }) {
    // One request: the index lists every country with its last update.
    const res = await fetch(INDEX);
    if (!res.ok) throw new Error(`GOV.UK index returned ${res.status}`);
    const index = (await res.json()) as { links: { children: IndexChild[] } };
    const updated = new Map(index.links.children.map((c) => [c.details.country.slug, c.public_updated_at.slice(0, 10)]));

    const slugs = new Map(destinations.map((d) => [d.code, d.govukSlug]));
    const results: ProviderResult[] = [];
    for (const { passport, destination } of pairs) {
      if (passport !== "GBR") continue;
      const slug = slugs.get(destination);
      if (!slug) continue;
      if (!updated.has(slug)) {
        log(`govuk: no travel advice page for slug "${slug}" (${destination})`);
        continue;
      }
      results.push({
        passport,
        destination,
        conditions: [],
        links: [
          {
            label: "GOV.UK entry requirements",
            url: `https://www.gov.uk/foreign-travel-advice/${slug}/entry-requirements`,
            role: "source",
          },
        ],
        sourceUpdatedAt: updated.get(slug),
      });
    }
    log(`govuk: ${results.length} British-passport pairs`);
    return results;
  },
};
