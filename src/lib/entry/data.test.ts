import { describe, expect, it } from "vitest";

import { entry } from "./index";

// The committed snapshot (src/data/entry-requirements.json), for the passports and places the demo uses.
const PASSPORTS = ["USA", "CAN", "GBR", "HKG", "CHN", "KOR", "JPN"];
const DESTINATIONS = ["CHN", "JPN", "KOR", "HKG", "TWN", "SGP", "MYS", "THA", "VNM"];

describe("entry data for the demo region", () => {
  it("has a rule with a source for every passport and destination", () => {
    for (const p of PASSPORTS) {
      for (const d of DESTINATIONS) {
        if (p === d) continue;
        const rule = entry.getRule(p, d);
        expect(rule.kind, `${p}→${d}`).not.toBe("unknown");
        expect(rule.links.some((l) => l.role === "source"), `${p}→${d}`).toBe(true);
      }
    }
  });

  it("has US passports needing a visa for mainland China, with the transit exemption", () => {
    expect(entry.getRule("USA", "CHN")).toMatchObject({ kind: "visa_required", origin: "curated" });
    expect(entry.getRule("USA", "CHN", "transit")).toMatchObject({ kind: "transit_exempt", allowedDays: 10 });
  });

  it("has Canadian and Japanese passports visa-free in mainland China until the scheme ends", () => {
    expect(entry.getRule("CAN", "CHN")).toMatchObject({ kind: "visa_free", allowedDays: 30, until: "2026-12-31", origin: "curated" });
    expect(entry.getRule("CAN", "CHN").links[0].url).toBe("https://travel.gc.ca/destinations/china");
    expect(entry.getRule("JPN", "CHN")).toMatchObject({ kind: "visa_free", allowedDays: 30, until: "2026-12-31", origin: "curated" });
  });

  it("uses permits, not visas, between Hong Kong and the mainland", () => {
    expect(entry.getRule("HKG", "CHN").kind).toBe("entry_permit");
    expect(entry.getRule("CHN", "HKG").kind).toBe("entry_permit");
  });
});
