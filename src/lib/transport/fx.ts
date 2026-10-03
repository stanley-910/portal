// Rough rates for adding up and comparing fares in different currencies. Never shown as a quote: a converted
// amount is always called "about".
const USD_RATE: Record<string, number> = {
  USD: 1, CNY: 0.138, HKD: 0.128, JPY: 0.0067, KRW: 0.00072, TWD: 0.031, THB: 0.028, MYR: 0.21, SGD: 0.74, EUR: 1.08,
  VND: 0.00004,
};

/** `amount` in `from`, roughly in `to`; null when either currency isn't known. */
export function approx(amount: number, from: string, to: string): number | null {
  const a = USD_RATE[from.toUpperCase()], b = USD_RATE[to.toUpperCase()];
  return a === undefined || b === undefined ? null : (amount * a) / b;
}
