import type { MeetupLeg, Money } from "./types";

// Fixed rates to compare fares across currencies. Ranking and the "≈ total" only; each leg keeps its own price.
const USD: Record<string, number> = {
  USD: 1, CNY: 0.138, HKD: 0.128, JPY: 0.0067, KRW: 0.00072, TWD: 0.031, THB: 0.028, MYR: 0.21, SGD: 0.74, EUR: 1.08,
};
export const toUsd = (p: Money | null) => (p && USD[p.currency.toUpperCase()] !== undefined ? p.amount * USD[p.currency.toUpperCase()] : null);

/** What an option costs everyone, in USD, or null when a leg has no price to compare. */
export function meetupTotal(legs: readonly MeetupLeg[]): Money | null {
  const usd = legs.map((leg) => toUsd(leg.price));
  if (usd.some((u) => u === null)) return null;
  return { amount: Math.round(usd.reduce((sum: number, u, j) => sum + u! * legs[j].people, 0)), currency: "USD" };
}
