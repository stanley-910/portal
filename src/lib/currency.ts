export const CURRENCIES = ["USD", "EUR", "CNY", "HKD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export type ExchangeRates = Partial<Record<string, number>> & Record<Currency, number>;

export function convertCurrency(amount: number, from: string, to: Currency, rates: ExchangeRates): number | null {
  const sourceRate = from === "USD" ? 1 : rates[from];
  const targetRate = to === "USD" ? 1 : rates[to];
  if (sourceRate === undefined || !Number.isFinite(amount) || !Number.isFinite(sourceRate) || !Number.isFinite(targetRate) || sourceRate <= 0 || targetRate <= 0) {
    return null;
  }
  return (amount / sourceRate) * targetRate;
}

export function formatCurrency(amount: number, currency: Currency): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(amount);
}
