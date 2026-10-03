export const CURRENCIES = ["USD", "EUR", "CNY", "HKD", "CAD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const isCurrency = (value: unknown): value is Currency => CURRENCIES.includes(value as Currency);

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

/** A price in the picked currency, or as it came when there are no rates for it. */
export function inCurrency(price: { amount: number; currency: string }, to: Currency, rates: ExchangeRates | null) {
  if (price.currency === to || !rates) return price;
  const amount = convertCurrency(price.amount, price.currency, to, rates);
  return amount === null ? price : { amount, currency: to };
}

/** "$152", "CN¥553": whole units, the currency's own symbol. */
export function formatMoney(price: { amount: number; currency: string }): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency, maximumFractionDigits: 0 }).format(price.amount);
}

/** Totals kept per currency, added up in the picked one. Null when any of them can't be converted. */
export function sumIn(totals: Record<string, number>, to: Currency, rates: ExchangeRates | null): number | null {
  let sum = 0;
  for (const [currency, amount] of Object.entries(totals)) {
    const converted = currency === to ? amount : rates ? convertCurrency(amount, currency, to, rates) : null;
    if (converted === null) return null;
    sum += converted;
  }
  return sum;
}
