import { describe, expect, it } from "vitest";
import { publishedFare } from "./fares";

describe("publishedFare", () => {
  it("reads THSR's standard car, either way and by any name", () => {
    expect(publishedFare({ country: "TW", operator: "Taiwan High Speed Rail", from: ["Taipei"], to: ["Zuoying"] })?.price).toEqual({ amount: 1490, currency: "TWD" });
    expect(publishedFare({ country: "TW", operator: "THSR", from: ["Zuoying"], to: ["Taipei"] })?.price.amount).toBe(1490);
  });

  it("prices a shinkansen only when the train stays on the line", () => {
    const calls = ["Tokyo", "Shinagawa", "Nagoya", "Kyoto", "Shin-Osaka"];
    expect(publishedFare({ country: "JP", operator: "JR Shinkansen", from: ["Tokyo"], to: ["Shin-Osaka"], calls })?.price).toEqual({ amount: 14200, currency: "JPY" });
    // a limited express from Hakata to Oita shares Kokura with the shinkansen but isn't one
    expect(publishedFare({ country: "JP", operator: "JR Kyushu", from: ["Hakata"], to: ["Kokura"], calls: ["Hakata", "Kokura", "Oita"] })).toBeNull();
  });

  it("picks the KTX route through the stations the train calls at", () => {
    const fare = (calls: string[]) => publishedFare({ country: "KR", operator: "KTX-산천", from: ["Seoul"], to: ["Busan"], calls })?.price.amount;
    expect(fare(["Seoul", "Gwangmyeong", "Daejeon", "Dongdaegu", "경주", "Busan"])).toBe(54400);
    expect(fare(["Seoul", "Daejeon", "Dongdaegu", "구포", "Busan"])).toBe(49300);
  });

  it("knows nothing about trains no table covers", () => {
    expect(publishedFare({ country: "KR", operator: "무궁화", from: ["Seoul"], to: ["Busan"] })).toBeNull();
    expect(publishedFare({ country: "MY", operator: "KTMB", from: ["JB Sentral"], to: ["KL Sentral"] })).toBeNull();
  });
});
