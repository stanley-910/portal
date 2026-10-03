import { describe, expect, it, vi } from "vitest";

// tools.ts reaches the Liveblocks client through edit.ts; check_entry only reads the plan it's given
vi.mock("@/lib/liveblocks/server", () => ({ liveblocks: () => ({}) }));

import { resolvePlace } from "./edit";
import { legEntry, stopBorder } from "./entry";
import type { PlanJson } from "./snapshot";
import { handlesFor } from "./snapshot";
import { agentTools, type ToolContext } from "./tools";

const at = (hub: string | null, lat: number, lng: number, name = hub ?? "somewhere") => ({ hub, lat, lng, name, code: null });
const WEST_KOWLOON = at("train:HK-WEST-KOWLOON", 22.3036, 114.165, "Hong Kong");
const HONGQIAO = at("train:SHANGHAI-HONGQIAO", 31.1945, 121.3201, "Shanghai");
const ICN = at("airport:ICN", 37.4602, 126.4407, "Seoul");
const PVG = at("airport:PVG", 31.1434, 121.8052, "Shanghai");
const NRT = at("airport:NRT", 35.772, 140.3929, "Tokyo");

describe("stopBorder", () => {
  it("reads the country from a stop's catalog hub, not an IATA code", () => {
    expect(stopBorder(PVG)).toEqual({ country: "CHN", iata: "PVG" });
    expect(stopBorder(WEST_KOWLOON)).toEqual({ country: "HKG", iata: undefined });
  });

  it("places a city Pip resolved by name, which has no hub", () => {
    const shanghai = resolvePlace("Shanghai");
    if (!("stop" in shanghai)) throw new Error("expected a stop");
    expect(shanghai.stop.hub).toBeNull();
    expect(stopBorder(shanghai.stop).country).toBe("CHN");
  });

  it("knows nothing about a point far from any hub", () => {
    expect(stopBorder(at(null, -40, -140))).toEqual({});
  });
});

describe("legEntry", () => {
  it("returns every passport, names each, and marks the easiest", () => {
    const answer = legEntry(WEST_KOWLOON, HONGQIAO, ["USA", "CAN"]);
    if (answer.crossesBorder !== true) throw new Error("expected a border");
    expect(answer.destination).toBe("Mainland China");
    expect(answer.passports.map((p) => [p.passport, p.requirement, p.easiest])).toEqual([
      ["USA", "visa_required", false],
      ["CAN", "visa_free", true],
    ]);
    const [usa, can] = answer.passports;
    expect(usa.transitOption).toMatchObject({ requirement: "transit_exempt", allowedDays: 10 });
    expect(usa.sources?.some((s) => s.role === "source")).toBe(true);
    expect(can).toMatchObject({ allowedDays: 30, until: "2026-12-31", freshness: "cached" });
    expect(can.sources?.[0].url).toBe("https://travel.gc.ca/destinations/china");
    expect(answer.easiest).toBe("Canada");
    expect(answer.passportsDiffer).toBe(true);
    expect(answer.summary).toMatch(/United States passport: needs a visa.*Canada passport: visa-free for up to 30 days/);
  });

  it("uses the transit exemption when the next leg goes on to a third country", () => {
    const answer = legEntry(ICN, PVG, ["USA"], NRT);
    if (answer.crossesBorder !== true) throw new Error("expected a border");
    expect(answer.passports[0]).toMatchObject({ requirement: "transit_exempt", usesTransit: true });
  });

  it("needs nothing on a passport of the destination itself", () => {
    const answer = legEntry(WEST_KOWLOON, HONGQIAO, ["USA", "CHN"]);
    if (answer.crossesBorder !== true) throw new Error("expected a border");
    expect(answer.passports.find((p) => p.easiest)).toMatchObject({ passport: "CHN", requirement: "own_country" });
  });

  it("says when a leg crosses no border, and refuses a destination it can't place", () => {
    expect(legEntry(PVG, HONGQIAO, ["USA"])).toMatchObject({ crossesBorder: false });
    expect(legEntry(PVG, at(null, -40, -140), ["USA"])).toMatchObject({ crossesBorder: null, refused: "UNKNOWN_COUNTRY" });
  });
});

describe("check_entry in a trip", () => {
  const search = { id: "s", status: "done", offers: [] };
  const plan: PlanJson = {
    members: {
      ana: { name: "Ana", color: 0, nationalities: ["USA", "CAN"] },
      joon: { name: "Joon", color: 1 },
    },
    stops: { hk: WEST_KOWLOON, sh: HONGQIAO, tk: NRT },
    legs: {
      l1: { from: "hk", to: "sh", date: "2026-10-09", createdBy: "ana", riders: ["ana", "joon"], search, votes: {}, chosen: null, createdAt: 1 },
      l2: { from: "sh", to: "tk", date: "2026-10-12", createdBy: "ana", riders: ["ana"], search, votes: {}, chosen: null, createdAt: 2 },
    },
  };
  const handles = handlesFor(plan);
  const ctx = { load: async () => ({ plan, handles }) } as unknown as ToolContext;
  const run = (leg: string) => agentTools(ctx).check_entry.execute!({ leg }, { toolCallId: "t", messages: [] } as never);

  it("returns every passport a member holds with the easiest flagged, and who has none recorded", async () => {
    const result = (await run("L1")) as { members: Record<string, unknown>[]; note: string };
    const [ana, joon] = result.members;
    expect(ana).toMatchObject({ member: "M1 Ana", rides: true, easiest: "Canada", passportsDiffer: true });
    expect((ana.passports as { passport: string; easiest: boolean }[]).map((p) => [p.passport, p.easiest])).toEqual([
      ["USA", false],
      ["CAN", true],
    ]);
    expect(joon).toEqual({ member: "M2 Joon", rides: true, status: "passport_not_provided" });
    expect(result.note).toMatch(/official government sources/);
  });

  it("works out transit from the member's next leg", async () => {
    const result = (await run("L1")) as { members: { passports?: { passport: string; usesTransit: boolean }[] }[] };
    expect(result.members[0].passports?.find((p) => p.passport === "USA")?.usesTransit).toBe(true);
  });

  it("refuses an unknown leg", async () => {
    expect(await run("L9")).toMatchObject({ refused: "UNKNOWN_HANDLE" });
  });
});
