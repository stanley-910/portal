import { describe, expect, it } from "vitest";

import { buildEntryData, mapDatasetValue, parseDatasetCsv, type BuildInput } from "./build";
import { CuratedEntry, EntryRule } from "./schema";

const meta = {
  name: "Test dataset",
  repo: "https://github.com/example/dataset",
  commit: "1ed37004913093900eba15eb7845cbd8067d93df",
  snapshotDate: "2026-06-14",
  licence: "MIT",
};

const source = { label: "Official", url: "https://example.gov/entry", role: "source" as const };

function input(overrides: Partial<BuildInput> = {}): BuildInput {
  return {
    config: { passports: ["USA", "GBR"], destinations: ["CHN", "JPN"] },
    dataset: {
      meta,
      rows: parseDatasetCsv(
        ["Passport,Destination,Requirement", "USA,CHN,e-visa", "USA,JPN,90", "GBR,CHN,30", "GBR,JPN,90", "USA,USA,-1"].join("\n"),
      ),
    },
    curated: [],
    destinations: [{ code: "CHN", name: "Mainland China", links: [] }],
    providers: [],
    ...overrides,
  };
}

const find = (rules: EntryRule[], passport: string, destination: string, context = "entry") =>
  rules.find((r) => r.passport === passport && r.destination === destination && r.context === context);

describe("mapDatasetValue", () => {
  it.each([
    ["90", { kind: "visa_free", allowedDays: 90 }],
    ["visa free", { kind: "visa_free" }],
    ["visa on arrival", { kind: "visa_on_arrival" }],
    ["eta", { kind: "eta" }],
    ["e-visa", { kind: "e_visa" }],
    ["visa required", { kind: "visa_required" }],
    ["no admission", { kind: "no_admission" }],
  ])("maps %s", (value, expected) => {
    expect(mapDatasetValue(value)).toEqual(expected);
  });

  it("skips the same-country marker and flags unknown values", () => {
    expect(mapDatasetValue("-1")).toBeNull();
    expect(mapDatasetValue("covid ban")).toBeUndefined();
  });
});

describe("parseDatasetCsv", () => {
  it("rejects an unexpected header", () => {
    expect(() => parseDatasetCsv("From,To,Value\nUSA,CHN,90")).toThrow(/header/);
  });
});

describe("buildEntryData", () => {
  it("marks dataset rules as estimated with the snapshot date", () => {
    const { data } = buildEntryData(input());
    expect(find(data.rules, "USA", "JPN")).toMatchObject({
      kind: "visa_free",
      allowedDays: 90,
      origin: "dataset",
      freshness: "estimated",
      datasetSnapshot: "2026-06-14",
    });
  });

  it("lets a curated entry override the dataset", () => {
    const curated = CuratedEntry.parse({
      passport: "USA",
      destination: "CHN",
      kind: "visa_required",
      links: [source],
      verifiedAt: "2026-10-02",
    });
    const { data, report } = buildEntryData(input({ curated: [curated] }));
    expect(find(data.rules, "USA", "CHN")).toMatchObject({ kind: "visa_required", origin: "curated", freshness: "cached" });
    expect(report.curated).toEqual([{ key: "entry USA→CHN", verifiedAt: "2026-10-02" }]);
  });

  it("expands a multi-passport curated entry to configured passports only", () => {
    const curated = CuratedEntry.parse({
      passports: ["USA", "GBR", "FRA"],
      destination: "CHN",
      context: "transit",
      kind: "transit_exempt",
      links: [source],
      verifiedAt: "2026-10-02",
    });
    const { data } = buildEntryData(input({ curated: [curated] }));
    const transit = data.rules.filter((r) => r.context === "transit").map((r) => r.passport);
    expect(transit).toEqual(["GBR", "USA"]);
  });

  it("never lets a provider change the kind, and reports the disagreement", () => {
    const { data, report } = buildEntryData(
      input({
        providers: [
          {
            provider: "travel-buddy",
            fetchedAt: "2026-10-02",
            results: [
              {
                passport: "USA",
                destination: "CHN",
                kind: "visa_required",
                conditions: ["Passport validity: 6 months"],
                links: [{ label: "Apply", url: "https://apply.example.gov", role: "apply" }],
              },
            ],
          },
        ],
      }),
    );
    const rule = find(data.rules, "USA", "CHN")!;
    expect(rule.kind).toBe("e_visa");
    expect(rule.links.map((l) => l.url)).toContain("https://apply.example.gov");
    expect(rule.conditions).toEqual(["Passport validity: 6 months"]);
    expect(report.disagreements).toEqual([
      { passport: "USA", destination: "CHN", provider: "travel-buddy", ours: "e_visa", origin: "dataset", theirs: "visa_required" },
    ]);
  });

  it("adds provider links and dates without a kind", () => {
    const { data } = buildEntryData(
      input({
        providers: [
          {
            provider: "govuk",
            fetchedAt: "2026-10-02",
            results: [
              {
                passport: "GBR",
                destination: "JPN",
                conditions: [],
                links: [{ label: "GOV.UK entry requirements", url: "https://www.gov.uk/foreign-travel-advice/japan/entry-requirements", role: "source" }],
                sourceUpdatedAt: "2026-08-28",
              },
            ],
          },
        ],
      }),
    );
    expect(find(data.rules, "GBR", "JPN")).toMatchObject({ kind: "visa_free", sourceUpdatedAt: "2026-08-28" });
  });

  it("lists configured pairs missing from the dataset", () => {
    const { report } = buildEntryData(input({ config: { passports: ["USA"], destinations: ["CHN", "ATA"] } }));
    expect(report.missingPairs).toEqual(["USA→ATA"]);
  });

  it("rejects duplicate curated entries", () => {
    const curated = CuratedEntry.parse({ passport: "USA", destination: "CHN", kind: "visa_required", links: [source], verifiedAt: "2026-10-02" });
    expect(() => buildEntryData(input({ curated: [curated, curated] }))).toThrow(/Duplicate/);
  });
});

describe("schema", () => {
  it("requires verifiedAt on curated rules only", () => {
    const base = { passport: "USA", destination: "CHN", kind: "visa_required", links: [source], freshness: "cached" };
    expect(EntryRule.safeParse({ ...base, origin: "curated" }).success).toBe(false);
    expect(EntryRule.safeParse({ ...base, origin: "dataset", verifiedAt: "2026-10-02" }).success).toBe(false);
    expect(EntryRule.safeParse({ ...base, origin: "curated", verifiedAt: "2026-10-02" }).success).toBe(true);
  });

  it("requires an official source on curated entries", () => {
    const entry = {
      passport: "USA",
      destination: "CHN",
      kind: "visa_required",
      links: [{ ...source, role: "apply" }],
      verifiedAt: "2026-10-02",
    };
    expect(CuratedEntry.safeParse(entry).success).toBe(false);
  });

  it("rejects codes that aren't three capitals", () => {
    const entry = { passport: "US", destination: "CHN", kind: "visa_required", links: [source], verifiedAt: "2026-10-02" };
    expect(CuratedEntry.safeParse(entry).success).toBe(false);
  });
});
