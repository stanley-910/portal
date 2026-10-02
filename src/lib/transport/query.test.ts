import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "./query";

const base = {
  fromName: "Hong Kong",
  fromLat: "22.31",
  fromLng: "113.92",
  fromIata: "hkg",
  fromCountry: "hk",
  toName: "Taipei",
  toLat: "25.08",
  toLng: "121.23",
  date: "2026-10-20",
};

const parse = (params: Record<string, string>) => parseSearchQuery(new URLSearchParams(params));

describe("parseSearchQuery", () => {
  it("parses a full query with defaults", () => {
    const r = parse(base);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toEqual({
      from: { name: "Hong Kong", lat: 22.31, lng: 113.92, iata: "HKG", country: "HK" },
      to: { name: "Taipei", lat: 25.08, lng: 121.23 },
      date: "2026-10-20",
      modes: [],
      passengers: 1,
      currency: "USD",
    });
  });

  it("parses modes, passengers and currency", () => {
    const r = parse({ ...base, modes: "train,bus", passengers: "2", currency: "twd" });
    expect(r.success && r.data).toMatchObject({ modes: ["train", "bus"], passengers: 2, currency: "TWD" });
  });

  it("treats empty optional params as absent", () => {
    const r = parse({ ...base, fromIata: "", modes: "", currency: "" });
    expect(r.success && r.data).toMatchObject({ modes: [], currency: "USD" });
    expect(r.success && r.data.from).not.toHaveProperty("iata");
  });

  it.each([
    ["missing date", { date: "" }, "date"],
    ["impossible date", { date: "2026-02-30" }, "date"],
    ["latitude out of range", { fromLat: "91" }, "fromLat"],
    ["non-numeric longitude", { toLng: "east" }, "toLng"],
    ["unknown mode", { modes: "train,rocket" }, "modes"],
    ["zero passengers", { passengers: "0" }, "passengers"],
    ["bad currency", { currency: "dollars" }, "currency"],
    ["bad iata", { fromIata: "HK" }, "fromIata"],
  ])("rejects %s", (_label, patch, field) => {
    const r = parse({ ...base, ...patch });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.fields).toContain(field);
  });
});
