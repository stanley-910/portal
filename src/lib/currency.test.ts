import { describe, expect, it } from "vitest";
import { convertCurrency, formatCurrency, type ExchangeRates } from "./currency";

const rates: ExchangeRates = { USD: 1, EUR: 0.92, CNY: 7.12, HKD: 7.82 };

describe("convertCurrency", () => {
  it("converts from USD using the target rate", () => {
    expect(convertCurrency(100, "USD", "HKD", rates)).toBeCloseTo(782);
  });

  it("converts between two non-USD currencies through the USD base", () => {
    expect(convertCurrency(782, "HKD", "EUR", rates)).toBeCloseTo(92);
  });

  it("returns null for an unknown or invalid source rate", () => {
    expect(convertCurrency(100, "GBP", "USD", rates)).toBeNull();
  });

  it("formats the selected ISO currency code", () => {
    expect(formatCurrency(12.5, "EUR")).toContain("EUR");
  });
});
