import { describe, expect, it } from "vitest";

import { isBlocking } from "./compose";
import { createEntryLookup } from "./lookup";
import type { EntryData, EntryRule } from "./schema";

const NIA = { label: "National Immigration Administration", url: "https://en.nia.gov.cn/policy", role: "source" as const };

const rule = (r: Partial<EntryRule> & Pick<EntryRule, "passport" | "destination" | "kind">): EntryRule => ({
  context: "entry",
  conditions: [],
  links: [],
  origin: "dataset",
  freshness: "estimated",
  datasetSnapshot: "2026-06-14",
  ...r,
});

const data: EntryData = {
  version: 1,
  dataset: {
    name: "Test dataset",
    repo: "https://github.com/example/dataset",
    commit: "1ed37004913093900eba15eb7845cbd8067d93df",
    snapshotDate: "2026-06-14",
    licence: "MIT",
  },
  destinations: {
    CHN: {
      code: "CHN",
      name: "Mainland China",
      links: [
        { label: "National Immigration Administration", url: "https://en.nia.gov.cn/", role: "info" },
        { label: "Visa application", url: "https://consular.mfa.gov.cn/VISA/", role: "apply", for: ["visa_required"] },
      ],
    },
  },
  rules: [
    rule({ passport: "USA", destination: "CHN", kind: "visa_required", origin: "curated", freshness: "cached", datasetSnapshot: undefined, verifiedAt: "2026-10-02", links: [NIA] }),
    rule({ passport: "GBR", destination: "CHN", kind: "visa_free", allowedDays: 30 }),
    rule({ passport: "USA", destination: "JPN", kind: "visa_free", allowedDays: 90 }),
    rule({
      passport: "USA",
      destination: "CHN",
      context: "transit",
      kind: "transit_exempt",
      allowedDays: 10,
      ports: ["PVG", "PEK"],
      origin: "curated",
      freshness: "cached",
      datasetSnapshot: undefined,
      verifiedAt: "2026-10-02",
      links: [NIA],
    }),
  ],
};

const entry = createEntryLookup(data);

describe("getRule", () => {
  it("returns unknown for a pair with no data", () => {
    expect(entry.getRule("KOR", "ATA")).toMatchObject({ kind: "unknown", origin: "none", freshness: "estimated" });
  });

  it("adds dataset attribution and destination links", () => {
    const links = entry.getRule("GBR", "CHN").links;
    expect(links[0]).toEqual({ role: "source", label: "Passport Index dataset", url: data.dataset.repo });
    expect(links.some((l) => l.role === "apply")).toBe(false);
  });

  it("adds the apply link for kinds that need a document", () => {
    const links = entry.getRule("USA", "CHN").links;
    expect(links.find((l) => l.role === "apply")?.url).toBe("https://consular.mfa.gov.cn/VISA/");
  });

  it("doesn't repeat an agency already cited as the source", () => {
    const labels = entry.getRule("USA", "CHN").links.map((l) => l.label);
    expect(labels.filter((l) => l === "National Immigration Administration")).toHaveLength(1);
  });

  it("is case-insensitive", () => {
    expect(entry.getRule("usa", "chn").kind).toBe("visa_required");
  });
});

describe("resolveLeg", () => {
  it("skips legs that cross no border", () => {
    expect(entry.resolveLeg({ fromHub: "PVG", toHub: "PEK" }, "USA").rule).toBeNull();
    expect(entry.resolveLeg({ fromHub: "HND", toHub: "JFK" }, "USA").rule).toBeNull();
  });

  it("uses transit when the member continues to a third country through an eligible port", () => {
    const leg = entry.resolveLeg({ fromHub: "ICN", toHub: "PVG", onwardCountry: "JPN" }, "USA");
    expect(leg).toMatchObject({ usesTransit: true, rule: { kind: "transit_exempt", allowedDays: 10 } });
  });

  it("offers transit as a hint when the itinerary doesn't qualify", () => {
    const back = entry.resolveLeg({ fromHub: "ICN", toHub: "PVG", onwardCountry: "KOR" }, "USA");
    expect(back).toMatchObject({ usesTransit: false, rule: { kind: "visa_required" }, transitOption: { kind: "transit_exempt" } });

    const noOnward = entry.resolveLeg({ fromHub: "ICN", toHub: "PVG" }, "USA");
    expect(noOnward.usesTransit).toBe(false);
    expect(noOnward.transitOption).toBeDefined();
  });

  it("doesn't use transit through an ineligible port", () => {
    const leg = entry.resolveLeg({ fromHub: "ICN", toHub: "CTU", onwardCountry: "JPN" }, "USA");
    expect(leg).toMatchObject({ usesTransit: false, rule: { kind: "visa_required" } });
  });

  it("doesn't offer transit when entry is already visa free", () => {
    expect(entry.resolveLeg({ fromHub: "ICN", toHub: "HND" }, "USA")).toEqual({
      rule: expect.objectContaining({ kind: "visa_free" }),
      usesTransit: false,
    });
  });
});

describe("getLegEntry", () => {
  it("gives each member their own result on the same leg", () => {
    const members = [
      { id: "a", name: "Ada", passport: "GBR" },
      { id: "s", name: "Sam", passport: "USA" },
    ];
    const kinds = entry.getLegEntry({ fromHub: "HKG", toHub: "PVG" }, members).map((m) => m.rule?.kind);
    expect(kinds).toEqual(["visa_free", "visa_required"]);
  });
});

describe("isBlocking", () => {
  it("blocks visa_required and no_admission only", () => {
    expect(isBlocking({ kind: "visa_required" })).toBe(true);
    expect(isBlocking({ kind: "no_admission" })).toBe(true);
    expect(isBlocking({ kind: "entry_permit" })).toBe(false);
    expect(isBlocking({ kind: "unknown" })).toBe(false);
  });
});

describe("country codes", () => {
  it("accepts ISO-2 from the transport contract (Place.country)", () => {
    expect(entry.getRule("US", "CN").kind).toBe("visa_required");
    expect(entry.resolveLeg({ fromCountry: "KR", toCountry: "CN", onwardCountry: "JP" }, "us")).toMatchObject({
      usesTransit: true,
    });
  });

  it("treats a member arriving in their own country as no border, whatever the code length", () => {
    expect(entry.resolveLeg({ toCountry: "US" }, "USA").rule).toBeNull();
  });

  it("returns unknown for an unrecognised code instead of throwing", () => {
    expect(entry.getRule("ZZ", "CN").kind).toBe("unknown");
  });
});
