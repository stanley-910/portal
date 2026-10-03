import "server-only";

import { z } from "zod";

import { env } from "@/lib/env.server";
import type { Money } from "@/lib/liveblocks/types";

import { BookingError } from "./errors";
import { matchOffer, offerSchema, type BookableOffer, type OfferLike, type TravellerDetails } from "./offer";

// Duffel's booking calls: read an offer, search again for the same flight with more seats, hold or buy an order, pay
// a held order from our balance, and cancel. Search results for the ticket come from the transport provider instead.

const API = "https://api.duffel.com";
const SUPPLIER_TIMEOUT_MS = 6_000;

type DuffelError = { code?: string; message?: string; title?: string; type?: string; source?: { field?: string; pointer?: string } };

async function duffel<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  if (!env.DUFFEL_ACCESS_TOKEN) throw new BookingError("NOT_CONFIGURED", "Duffel isn't configured.");
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${env.DUFFEL_ACCESS_TOKEN}`,
        "Duffel-Version": "v2",
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new BookingError("UPSTREAM_ERROR", "Couldn't reach Duffel.");
  }
  const json = (await response.json().catch(() => null)) as { data?: unknown; errors?: DuffelError[] } | null;
  if (!response.ok) {
    const first = json?.errors?.[0];
    // codes are safe to keep; messages can quote passenger data, so they stay in the server log
    console.warn("[duffel]", response.status, first?.type, first?.code);
    throw new BookingError(codeFor(response.status, first), first?.title ?? "Duffel refused the request.", {
      status: response.status,
      code: first?.code,
      // which traveller field the airline refused, e.g. "/passengers/1/given_name"
      field: first?.source?.pointer ?? first?.source?.field,
    });
  }
  return json?.data as T;
}

function codeFor(status: number, error: DuffelError | undefined): BookingError["code"] {
  const code = error?.code ?? "";
  if (status === 404 || code === "not_found") return "NOT_FOUND";
  if (/offer_no_longer_available|offer_expired|offer_request_expired|no_longer_available|already_booked/.test(code)) return "OFFER_GONE";
  if (/price_changed|offer_price_changed/.test(code)) return "PRICE_CHANGED";
  if (status === 401 || status === 403) return "NOT_CONFIGURED";
  if (status >= 500 || status === 429) return "UPSTREAM_ERROR";
  return "ORDER_FAILED";
}

/** An offer by id. Once it expires Duffel refuses it (`offer_no_longer_available`, read as OFFER_GONE). */
export async function getOffer(offerId: string): Promise<BookableOffer> {
  const raw = await duffel<unknown>("GET", `/air/offers/${encodeURIComponent(offerId)}`);
  const parsed = offerSchema.safeParse(raw);
  if (!parsed.success) throw new BookingError("UPSTREAM_ERROR", "Duffel's offer didn't parse.");
  return parsed.data;
}

/**
 * Searches the same airports and date again with `passengers` adults and returns the offer for the same flights,
 * or null when they're sold out or gone. Prices come back for the whole party, as Duffel quotes them.
 */
export async function findOfferFor(like: OfferLike, passengers: number): Promise<BookableOffer | null> {
  const params = new URLSearchParams({ return_offers: "true", supplier_timeout: String(SUPPLIER_TIMEOUT_MS) });
  const raw = await duffel<{ offers?: unknown[] }>("POST", `/air/offer_requests?${params}`, {
    data: {
      slices: [{ origin: like.origin, destination: like.destination, departure_date: like.date }],
      passengers: Array.from({ length: passengers }, () => ({ type: "adult" })),
      cabin_class: "economy",
      max_connections: like.flights.length > 1 ? 1 : 0,
    },
  });
  return matchOffer(like, raw?.offers ?? [], passengers);
}

const orderSchema = z.object({
  id: z.string().min(1),
  booking_reference: z.string().nullish(),
  total_amount: z.string(),
  total_currency: z.string(),
  type: z.enum(["instant", "hold"]).nullish(),
  payment_status: z.object({
    awaiting_payment: z.boolean(),
    payment_required_by: z.string().nullish(),
    price_guarantee_expires_at: z.string().nullish(),
    paid_at: z.string().nullish(),
  }),
  cancelled_at: z.string().nullish(),
});

export type DuffelOrder = {
  id: string;
  reference: string | null;
  total: Money;
  type: "instant" | "hold" | null;
  awaitingPayment: boolean;
  paymentRequiredBy: string | null;
  priceGuaranteeExpiresAt: string | null;
  cancelledAt: string | null;
};

const toOrder = (raw: unknown): DuffelOrder => {
  const parsed = orderSchema.safeParse(raw);
  if (!parsed.success) throw new BookingError("UPSTREAM_ERROR", "Duffel's order didn't parse.");
  const o = parsed.data;
  return {
    id: o.id,
    reference: o.booking_reference ?? null,
    total: { amount: Number(o.total_amount), currency: o.total_currency },
    type: o.type ?? null,
    awaitingPayment: o.payment_status.awaiting_payment,
    paymentRequiredBy: o.payment_status.payment_required_by ?? null,
    priceGuaranteeExpiresAt: o.payment_status.price_guarantee_expires_at ?? null,
    cancelledAt: o.cancelled_at ?? null,
  };
};

/** Traveller details as Duffel's passenger object, keyed to the offer's passenger ids in rider order. */
export function toPassenger(passengerId: string, t: TravellerDetails) {
  return {
    id: passengerId,
    title: t.title,
    gender: t.gender,
    given_name: t.givenName,
    family_name: t.familyName,
    born_on: t.bornOn,
    email: t.email,
    phone_number: t.phone,
    ...(t.passport
      ? {
          identity_documents: [
            { type: "passport", unique_identifier: t.passport.number, issuing_country_code: t.passport.country, expires_on: t.passport.expiresOn },
          ],
        }
      : {}),
  };
}

/**
 * Books the offer for these travellers. A hold fixes the seats and, for a while, the price, to be paid later from
 * our balance. An instant order is paid from the balance now. The idempotency key stops a retry booking twice.
 */
export async function createOrder(input: {
  offer: BookableOffer;
  travellers: TravellerDetails[];
  type: "hold" | "instant";
  idempotencyKey: string;
  metadata: Record<string, string>;
}): Promise<DuffelOrder> {
  if (input.travellers.length !== input.offer.passengerIds.length) throw new BookingError("WRONG_STATE", "One traveller per seat.");
  const raw = await duffel<unknown>(
    "POST",
    "/air/orders",
    {
      data: {
        type: input.type,
        selected_offers: [input.offer.id],
        passengers: input.travellers.map((t, i) => toPassenger(input.offer.passengerIds[i], t)),
        ...(input.type === "instant" ? { payments: [{ type: "balance", amount: input.offer.total.amount.toFixed(2), currency: input.offer.total.currency }] } : {}),
        metadata: input.metadata,
      },
    },
    input.idempotencyKey,
  );
  return toOrder(raw);
}

export const getOrder = async (orderId: string) => toOrder(await duffel<unknown>("GET", `/air/orders/${encodeURIComponent(orderId)}`));

/** Pays a held order from our balance. The amount must be the order's current total, so read the order first. */
export async function payOrder(order: DuffelOrder, idempotencyKey: string): Promise<void> {
  try {
    await duffel<unknown>(
      "POST",
      "/air/payments",
      { data: { order_id: order.id, payment: { type: "balance", amount: order.total.amount.toFixed(2), currency: order.total.currency } } },
      idempotencyKey,
    );
  } catch (e) {
    // a retried purchase finds the order already paid: that's the outcome we wanted. Duffel names it
    // already_paid or order_type_not_eligible_for_payment, so ask the order rather than match codes.
    const now = await getOrder(order.id).catch(() => null);
    if (now && !now.awaitingPayment && !now.cancelledAt) return;
    throw e;
  }
}

/** Cancels an order: a two-step request and confirm. An unpaid hold refunds nothing, so there's nothing to track. */
export async function cancelOrder(orderId: string): Promise<void> {
  const created = await duffel<{ id: string }>("POST", "/air/order_cancellations", { data: { order_id: orderId } });
  await duffel<unknown>("POST", `/air/order_cancellations/${encodeURIComponent(created.id)}/actions/confirm`);
}
