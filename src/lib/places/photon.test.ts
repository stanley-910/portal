import { describe, expect, it } from "vitest";

import { photonUrl, toPlaces, type PhotonFeature } from "./photon";

const feature = (properties: PhotonFeature["properties"], lng = 110.458, lat = 29.1714): PhotonFeature => ({
  geometry: { coordinates: [lng, lat] },
  properties: { osm_type: "N", osm_id: 1, countrycode: "CN", ...properties },
});

describe("photon", () => {
  it("asks only for places, stations, airports and ferry terminals", () => {
    const url = new URL(photonUrl("zhangjiajiexi"));
    expect(url.searchParams.get("q")).toBe("zhangjiajiexi");
    expect(url.searchParams.getAll("osm_tag")).toEqual(
      expect.arrayContaining(["place", "railway:station", "aeroway:aerodrome", "amenity:ferry_terminal"]),
    );
  });

  it("maps a station with its country", () => {
    const [place] = toPlaces([feature({ osm_key: "railway", osm_value: "station", name: "Zhangjiajiexi" })]);
    expect(place).toMatchObject({ kind: "station", name: "Zhangjiajiexi", detail: "China", lat: 29.1714, lng: 110.458, source: "osm" });
    expect(place.label).toBeUndefined();
  });

  it("labels settlements and frames regions by their extent", () => {
    const [town, province] = toPlaces([
      feature({ osm_key: "place", osm_value: "town", name: "Wulingyuan" }),
      feature({ osm_key: "place", osm_value: "province", name: "Hunan", extent: [108.8, 30.1, 114.3, 24.6] }, 111.7, 27.6),
    ]);
    expect(town).toMatchObject({ kind: "city", label: "Town", spanDeg: 1.5 });
    expect(province).toMatchObject({ kind: "region", label: "Province" });
    expect(province.spanDeg).toBeCloseTo(5.5, 1);
  });

  it("drops neighbourhoods, unnamed places and bad coordinates", () => {
    expect(toPlaces([
      feature({ osm_key: "place", osm_value: "neighbourhood", name: "Kyoto" }),
      feature({ osm_key: "railway", osm_value: "station" }),
      feature({ osm_key: "place", osm_value: "city", name: "Nowhere" }, NaN, NaN),
    ])).toEqual([]);
  });
});
