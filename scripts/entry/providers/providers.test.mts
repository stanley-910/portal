import { afterEach, describe, expect, it, vi } from "vitest";

import { govukProvider } from "./govuk.mts";
import { mapRuleName, normalise } from "./travel-buddy.mts";
import type { ProviderContext } from "./types.mts";

const ctx = (pairs: ProviderContext["pairs"]): ProviderContext => ({
  pairs,
  destinations: [
    { code: "JPN", govukSlug: "japan" },
    { code: "XXX", govukSlug: "atlantis" },
  ],
  maxRequests: 0,
  cacheDir: "/nonexistent",
  log: () => {},
});

afterEach(() => vi.unstubAllGlobals());

describe("govuk provider", () => {
  const index = {
    links: {
      children: [{ public_updated_at: "2026-08-28T16:22:35+01:00", details: { country: { slug: "japan" } } }],
    },
  };

  it("adds a dated GOV.UK source link for British passports only", async () => {
    const fetch = vi.fn(async () => Response.json(index));
    vi.stubGlobal("fetch", fetch);
    const results = await govukProvider.run(
      ctx([
        { passport: "GBR", destination: "JPN" },
        { passport: "USA", destination: "JPN" },
      ]),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      {
        passport: "GBR",
        destination: "JPN",
        conditions: [],
        links: [
          { label: "GOV.UK entry requirements", url: "https://www.gov.uk/foreign-travel-advice/japan/entry-requirements", role: "source" },
        ],
        sourceUpdatedAt: "2026-08-28",
      },
    ]);
  });

  it("skips slugs GOV.UK doesn't publish", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(index)));
    expect(await govukProvider.run(ctx([{ passport: "GBR", destination: "XXX" }]))).toEqual([]);
  });

  it("fails loudly when the index is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(govukProvider.run(ctx([{ passport: "GBR", destination: "JPN" }]))).rejects.toThrow(/503/);
  });
});

describe("travel buddy normalisation", () => {
  it.each([
    ["Visa-free", "visa_free"],
    ["Visa on arrival", "visa_on_arrival"],
    ["eVisa", "e_visa"],
    ["K-ETA", "eta"],
    ["eTA", "eta"],
    ["Visa required", "visa_required"],
    ["Not admitted", "no_admission"],
    ["Something new", undefined],
  ])("maps %s", (name, kind) => {
    expect(mapRuleName(name)).toBe(kind);
  });

  it("keeps official destinations of redirect links, with days and conditions", async () => {
    const result = await normalise(
      "CHN",
      "IDN",
      {
        data: {
          destination: { passport_validity: "6 months" },
          mandatory_registration: { name: "e-Arrival", link: "https://link.travel-buddy.ai/a" },
          visa_rules: {
            primary_rule: { name: "Visa on arrival", duration: "30 days" },
            secondary_rule: { name: "eVisa", duration: "30 days", link: "https://link.travel-buddy.ai/b" },
          },
        },
      },
      async (url) => url.replace("https://link.travel-buddy.ai/", "https://official.go.id/"),
    );
    expect(result).toEqual({
      passport: "CHN",
      destination: "IDN",
      kind: "visa_on_arrival",
      allowedDays: 30,
      conditions: ["Passport validity: 6 months", "e-Arrival before arrival"],
      links: [
        { label: "eVisa", url: "https://official.go.id/b", role: "apply" },
        { label: "e-Arrival", url: "https://official.go.id/a", role: "info" },
      ],
    });
  });
});
