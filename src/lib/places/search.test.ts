import { describe, expect, it } from "vitest";

import { fold, mergePlaces, searchPlaces, type PlaceResult } from "./search";

describe("searchPlaces", () => {
  it("finds a city by the start of its name", () => {
    const [top] = searchPlaces("shang");
    expect(top).toMatchObject({ kind: "city", name: "Shanghai", detail: "China" });
  });

  it("folds a city's districts into one city", () => {
    const names = searchPlaces("shanghai", undefined, 20).map((p) => p.name);
    expect(names.filter((n) => n.startsWith("Shanghai ("))).toEqual([]);
    expect(names).toContain("Shanghai Pudong International Airport");
  });

  it("puts an exact airport code first", () => {
    expect(searchPlaces("hkg")[0]).toMatchObject({ kind: "airport", code: "HKG" });
    expect(searchPlaces("ICN")[0]).toMatchObject({ kind: "airport", code: "ICN" });
  });

  it("finds countries and frames them whole", () => {
    const japan = searchPlaces("japan").find((p) => p.kind === "country");
    expect(japan).toMatchObject({ name: "Japan", detail: "" });
    expect(japan!.spanDeg).toBeGreaterThan(5);
  });

  it("matches a later word and ignores accents and case", () => {
    expect(searchPlaces("west kowloon").map((p) => p.name)).toContain("Hong Kong West Kowloon");
    expect(fold("Côte d'Ivoire")).toBe("cote d ivoire");
    expect(searchPlaces("ESKISEHIR")[0]).toMatchObject({ kind: "city", name: "Eskişehir" });
  });

  it("returns nothing for blank or unmatched text", () => {
    expect(searchPlaces("  ")).toEqual([]);
    expect(searchPlaces("zzqx")).toEqual([]);
  });

  it("keeps one row per name and country", () => {
    const rows = searchPlaces("hong kong", undefined, 20).map((p) => `${p.name}|${p.detail}`);
    expect(new Set(rows).size).toBe(rows.length);
  });
});

describe("mergePlaces", () => {
  const place = (name: string, kind: PlaceResult["kind"], lat: number, lng: number, detail = "China"): PlaceResult =>
    ({ id: `${kind}:${name}`, kind, name, detail, lat, lng, spanDeg: 1 });

  it("puts bundled places first and drops online duplicates", () => {
    const local = [place("Zhangjiajie", "city", 29.1, 110.44)];
    const online = [
      place("Zhangjiajie", "city", 29.12, 110.47),
      place("Zhangjiajiexi", "station", 29.1714, 110.458),
      place("Zhangjiajie Hehua", "station", 29.1, 110.441),
    ];
    expect(mergePlaces(local, online).map((p) => p.name)).toEqual(["Zhangjiajie", "Zhangjiajiexi", "Zhangjiajie Hehua"]);
  });

  it("caps each source", () => {
    const many = Array.from({ length: 10 }, (_, i) => place(`P${i}`, "city", i * 10, i * 10));
    expect(mergePlaces(many, many.map((p) => ({ ...p, id: `o${p.id}`, name: `O${p.name}`, lat: p.lat + 1 })))).toHaveLength(10);
  });
});
