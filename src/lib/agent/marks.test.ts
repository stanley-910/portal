import { describe, expect, it } from "vitest";

import { changeStart, legMarks, midpoint } from "./marks";

const hk = { name: "Hong Kong", lat: 22.3, lng: 114.2 };
const sh = { name: "Shanghai", lat: 31.2, lng: 121.5 };
const tk = { name: "Tokyo", lat: 35.7, lng: 139.7 };

describe("midpoint", () => {
  it("is halfway along the great circle", () => {
    const m = midpoint({ lat: 0, lng: 10 }, { lat: 0, lng: 30 });
    expect(m.lat).toBeCloseTo(0);
    expect(m.lng).toBeCloseTo(20);
  });

  it("crosses the date line the short way", () => {
    expect(midpoint({ lat: 0, lng: 170 }, { lat: 0, lng: -170 }).lng).toBeCloseTo(180);
  });
});

describe("legMarks", () => {
  it("pops the legs that went and the ones that came, and none that stayed", () => {
    const marks = legMarks([{ from: hk, to: sh }, { from: sh, to: hk }], [{ from: hk, to: sh }, { from: sh, to: tk }]);
    expect(marks.map((m) => m.text)).toEqual(["Removed Shanghai → Hong Kong", "Added Shanghai → Tokyo"]);
  });

  it("pops each over where its leg ends, not out at sea between", () => {
    expect(legMarks([], [{ from: hk, to: tk }])[0]!.at).toEqual({ lat: tk.lat, lng: tk.lng });
  });

  it("pops a leg that went over its start, where it reels back to", () => {
    expect(legMarks([{ from: sh, to: tk }], [])[0]!.at).toEqual({ lat: sh.lat, lng: sh.lng });
  });

  it("orders the legs that went from the end back, then the ones that came, and starts where the last went", () => {
    const before = [{ from: hk, to: sh }, { from: sh, to: tk }, { from: tk, to: hk }];
    const after = [{ from: hk, to: sh }, { from: sh, to: hk }];
    expect(legMarks(before, after).map((m) => [m.text, m.leg?.gone ?? false])).toEqual([
      ["Removed Tokyo → Hong Kong", true],
      ["Removed Shanghai → Tokyo", true],
      ["Added Shanghai → Hong Kong", false],
    ]);
    expect(changeStart(before, after)).toEqual({ lat: hk.lat, lng: hk.lng });
  });
});
