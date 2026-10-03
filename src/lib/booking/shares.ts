import type { BookingSeat, Money } from "@/lib/liveblocks/types";

// The arithmetic of a leg's booking (docs/booking/README.md): who owes what, when the hold lapses, and what Stripe
// is told. Pure, so the flow's decisions are testable without Duffel or Stripe.

/** Currencies Stripe counts in whole units, not hundredths. */
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);

export const decimals = (currency: string) => (ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2);

/** Rounds to what the currency can pay: cents, or whole yen. */
export function roundMoney(amount: number, currency: string): number {
  const f = 10 ** decimals(currency);
  return Math.round(amount * f) / f;
}

/** A Stripe amount: the smallest unit of the currency, as an integer. */
export const minorUnits = (money: Money) => Math.round(money.amount * 10 ** decimals(money.currency));

/** Back from Stripe's integer to an amount. */
export const fromMinorUnits = (units: number, currency: string) => units / 10 ** decimals(currency);

/**
 * Each rider's share of the order: the total divided evenly and rounded to what the currency can pay, with the
 * rounding remainder on the rider who settled, so the shares add up to the total exactly.
 */
export function splitShares(total: Money, riders: readonly string[], settledBy: string): Record<string, Money> {
  if (!riders.length) return {};
  const f = 10 ** decimals(total.currency);
  const units = Math.round(total.amount * f);
  const each = Math.floor(units / riders.length);
  const remainder = units - each * riders.length;
  const payer = riders.includes(settledBy) ? settledBy : riders[0];
  return Object.fromEntries(
    riders.map((id) => [id, { amount: (each + (id === payer ? remainder : 0)) / f, currency: total.currency }]),
  );
}

/** Reads a time the airline or Stripe gave; null when it's missing or unreadable. */
const at = (iso: string | null | undefined) => (iso && Number.isFinite(Date.parse(iso)) ? Date.parse(iso) : null);

export const DEADLINE_MARGIN_MS = 60 * 60 * 1000;

/**
 * When a group booking must be complete: the earliest of the price guarantee, the airline's pay-by time and the
 * riders' card holds, less an hour of margin. Null when none of them is known.
 */
export function bookingDeadline(
  limits: { priceGuaranteeExpiresAt?: string | null; paymentRequiredBy?: string | null; captureBefore?: (string | null | undefined)[] },
  marginMs = DEADLINE_MARGIN_MS,
): string | null {
  const times = [limits.priceGuaranteeExpiresAt, limits.paymentRequiredBy, ...(limits.captureBefore ?? [])].map(at);
  const known = times.filter((t): t is number => t !== null);
  if (!known.length) return null;
  return new Date(Math.min(...known) - marginMs).toISOString();
}

export const allDetailsIn = (seats: Record<string, BookingSeat>) => Object.values(seats).every((s) => s.details);
export const allPaid = (seats: Record<string, BookingSeat>) => Object.values(seats).every((s) => s.paid);
export const anyonePaid = (seats: Record<string, BookingSeat>) => Object.values(seats).some((s) => s.paid);
export const paidCount = (seats: Record<string, BookingSeat>) => Object.values(seats).filter((s) => s.paid).length;

/** The seats of a fresh booking: everyone owes their share, nobody has done anything yet. */
export function openSeats(shares: Record<string, Money>): Record<string, BookingSeat> {
  return Object.fromEntries(Object.entries(shares).map(([id, share]) => [id, { share, details: false, paid: false }]));
}

/** A rise up to this share of the agreed price still goes through: airlines round, and test fares jitter. */
export const PRICE_TOLERANCE = 0.02;

/**
 * Whether a price has risen past what the group agreed to, so they must see it before going on. A lower price never
 * blocks; a new currency always does.
 */
export function priceRose(agreed: Money | null, now: Money): boolean {
  if (!agreed || agreed.currency !== now.currency) return true;
  return now.amount > agreed.amount * (1 + PRICE_TOLERANCE) + 1 / 10 ** decimals(now.currency);
}
