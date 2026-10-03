import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env.server";
import type { Money } from "@/lib/liveblocks/types";

import { BookingError } from "./errors";
import { minorUnits } from "./shares";

// Stripe over plain fetch: Checkout Sessions with manual capture for the card holds, and PaymentIntent capture or
// cancel once the group has paid or the deadline has passed. The few calls we need don't justify the SDK.

const API = "https://api.stripe.com/v1";

export const stripeConfigured = () => !!env.STRIPE_SECRET_KEY;

/**
 * Whether the no-charge test checkout may stand in for Stripe: only while Duffel itself is in test mode, so a deploy
 * with a live airline token and no Stripe key can't buy real tickets for free.
 */
/**
 * Whether booking may run with these keys: Duffel and Stripe both in test mode or both live. A live airline with test
 * cards would buy real tickets with our balance and collect nothing; test fares on live cards would charge for
 * nothing. Without Stripe only the no-charge test checkout runs, which needs a Duffel test token.
 */
export function bookingModes(duffelToken: string | undefined, stripeKey: string | undefined): { ok: true; mode: "test" | "live" } | { ok: false; reason: string } {
  const duffel = duffelToken?.startsWith("duffel_live_") ? "live" : duffelToken?.startsWith("duffel_test_") ? "test" : null;
  const stripeMode = !stripeKey ? null : /^(sk|rk)_live_/.test(stripeKey) ? "live" : /^(sk|rk)_test_/.test(stripeKey) ? "test" : null;
  if (!duffel) return { ok: false, reason: "Duffel isn't set up on this server." };
  if (!stripeKey) return duffel === "test" ? { ok: true, mode: "test" } : { ok: false, reason: "Payments aren't set up on this server." };
  if (stripeMode !== duffel) return { ok: false, reason: `Booking is off: the airline is in ${duffel} mode and payments in ${stripeMode ?? "an unknown"} mode.` };
  return { ok: true, mode: duffel };
}

export const testCheckoutAllowed = () => !env.STRIPE_SECRET_KEY && !!env.DUFFEL_ACCESS_TOKEN?.startsWith("duffel_test_");

/** Nested params the way Stripe's form encoding wants them: `a[b][c]=v`. */
export function formEncode(params: Record<string, unknown>, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) value.forEach((v, i) => (typeof v === "object" ? formEncode(v as Record<string, unknown>, `${name}[${i}]`, out) : out.append(`${name}[${i}]`, String(v))));
    else if (typeof value === "object") formEncode(value as Record<string, unknown>, name, out);
    else out.append(name, String(value));
  }
  return out;
}

async function stripe<T>(method: "GET" | "POST", path: string, params: Record<string, unknown> = {}, idempotencyKey?: string): Promise<T> {
  if (!env.STRIPE_SECRET_KEY) throw new BookingError("NOT_CONFIGURED", "Stripe isn't configured.");
  const body = formEncode(params);
  const url = method === "GET" && body.size ? `${API}${path}?${body}` : `${API}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Stripe-Version": "2025-08-27.basil",
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: method === "POST" ? body : undefined,
    });
  } catch {
    throw new BookingError("UPSTREAM_ERROR", "Couldn't reach Stripe.");
  }
  const json = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string; type?: string } } | null;
  if (!response.ok) {
    // the message is logged, never shown: it can name card details Stripe wants kept with the payment
    console.warn("[stripe]", response.status, json?.error?.type, json?.error?.code);
    throw new BookingError("PAYMENT_FAILED", "Stripe refused the request.", { status: response.status, code: json?.error?.code });
  }
  return json as T;
}

export type CheckoutSession = { id: string; url: string | null; status: string | null; payment_status: string; payment_intent: string | null };

/**
 * A hosted Checkout page that authorises the rider's share without taking it (`capture_method: manual`). The session
 * carries the room, leg and rider so the webhook and the return route can find the seat.
 */
export async function createHoldCheckout(input: {
  share: Money;
  name: string;
  description: string;
  email: string | null;
  successUrl: string;
  cancelUrl: string;
  metadata: { roomId: string; legId: string; riderId: string };
  /** Seconds the page stays open; Stripe allows 30 minutes to 24 hours. */
  expiresInSec?: number;
}): Promise<CheckoutSession> {
  const now = Math.floor(Date.now() / 1000);
  return stripe<CheckoutSession>("POST", "/checkout/sessions", {
    mode: "payment",
    // a hold that is captured days later needs a card; wallets and bank debits would be taken at once or not at all
    payment_method_types: ["card"],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.email ?? undefined,
    expires_at: now + Math.min(24 * 3600, Math.max(1800, input.expiresInSec ?? 3600)),
    line_items: [{ quantity: 1, price_data: { currency: input.share.currency.toLowerCase(), unit_amount: minorUnits(input.share), product_data: { name: input.name, description: input.description } } }],
    payment_intent_data: { capture_method: "manual", description: input.description, metadata: input.metadata },
    metadata: input.metadata,
    // Stripe's Managed Payments (on by default for new accounts) makes Stripe the merchant of record and needs a tax
    // code per product. The airline sells the ticket, so it's off here.
    managed_payments: { enabled: false },
  });
}

export const getCheckoutSession = (id: string) => stripe<CheckoutSession>("GET", `/checkout/sessions/${encodeURIComponent(id)}`);

export type PaymentIntent = {
  id: string;
  status: string;
  amount: number;
  amount_capturable: number;
  amount_received: number;
  currency: string;
  latest_charge?: { payment_method_details?: { card?: { capture_before?: number | null } | null } | null } | string | null;
  metadata?: Record<string, string>;
};

/** The intent with its charge, for the hold's status and how long the card keeps it. */
export const getPaymentIntent = (id: string) => stripe<PaymentIntent>("GET", `/payment_intents/${encodeURIComponent(id)}`, { expand: ["latest_charge"] });

/** Seconds since the epoch the authorisation lapses, as ISO 8601; null when Stripe hasn't said. */
export function captureBefore(intent: PaymentIntent): string | null {
  const charge = intent.latest_charge;
  const at = typeof charge === "object" ? charge?.payment_method_details?.card?.capture_before : null;
  return typeof at === "number" ? new Date(at * 1000).toISOString() : null;
}

/** Takes `amount` of the hold; Stripe releases the rest. Idempotent per key, so a retried purchase can't take twice. */
export const capturePayment = (id: string, amount: Money, idempotencyKey: string) =>
  stripe<PaymentIntent>("POST", `/payment_intents/${encodeURIComponent(id)}/capture`, { amount_to_capture: minorUnits(amount) }, idempotencyKey);

/** Releases a hold. An intent already captured or cancelled comes back as a refusal, which callers treat as done. */
export async function cancelPayment(id: string): Promise<void> {
  try {
    await stripe<PaymentIntent>("POST", `/payment_intents/${encodeURIComponent(id)}/cancel`, { cancellation_reason: "abandoned" });
  } catch (e) {
    const intent = await getPaymentIntent(id).catch(() => null);
    if (intent?.status === "canceled" || intent?.status === "succeeded") return;
    throw e;
  }
}

export type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };

/**
 * Verifies `Stripe-Signature` by hand: HMAC-SHA256 of `${t}.${body}` with the endpoint secret, constant-time compared
 * with each `v1` signature, and the timestamp within `toleranceSec` of `nowSec`. Null means don't trust the body.
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): StripeEvent | null {
  if (!header) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t" && /^\d+$/.test(v ?? "")) timestamp = Number(v);
    else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v ?? "")) signatures.push(v.toLowerCase());
  }
  if (timestamp === null || !signatures.length || Math.abs(nowSec - timestamp) > toleranceSec) return null;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"));
  if (!signatures.some((s) => timingSafeEqual(Buffer.from(s), expected))) return null;
  try {
    const event = JSON.parse(rawBody) as StripeEvent;
    return typeof event?.type === "string" && event.data?.object ? event : null;
  } catch {
    return null;
  }
}

// Paying in the app, without leaving it: a PaymentIntent the browser confirms with Stripe.js, on a card saved to the
// person's Stripe customer or a new one typed into the embedded card field, which saves it for next time.

/** A new Stripe customer for a person; their saved cards hang off it. */
export const createCustomer = (personId: string, email: string | null, name: string | null) =>
  stripe<{ id: string }>("POST", "/customers", { email: email ?? undefined, name: name ?? undefined, metadata: { person_id: personId } }, `customer:${personId}`);

export type SavedCard = { id: string; brand: string; last4: string; expMonth: number; expYear: number };

/** The person's saved cards, newest first. */
export async function listCards(customerId: string): Promise<SavedCard[]> {
  type Pm = { id: string; card?: { brand: string; last4: string; exp_month: number; exp_year: number } };
  const res = await stripe<{ data: Pm[] }>("GET", `/customers/${encodeURIComponent(customerId)}/payment_methods`, { type: "card", limit: 5 });
  return res.data.flatMap((pm) => (pm.card ? [{ id: pm.id, brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year }] : []));
}

export type HoldIntent = { id: string; client_secret: string; status: string };

/**
 * A card hold for the rider's share, for the browser to confirm: on `paymentMethod` when they picked a saved card, or
 * on what they type, which is then saved to `customer` for next time.
 */
export const createHoldIntent = (input: {
  share: Money;
  customer: string;
  paymentMethod: string | null;
  description: string;
  metadata: { roomId: string; legId: string; riderId: string };
}) =>
  stripe<HoldIntent>("POST", "/payment_intents", {
    amount: minorUnits(input.share),
    currency: input.share.currency.toLowerCase(),
    customer: input.customer,
    payment_method: input.paymentMethod ?? undefined,
    payment_method_types: ["card"],
    capture_method: "manual",
    setup_future_usage: input.paymentMethod ? undefined : "on_session",
    description: input.description,
    metadata: input.metadata,
  });
