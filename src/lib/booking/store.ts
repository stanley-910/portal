import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env.server";
import type { Money } from "@/lib/liveblocks/types";
import { supabaseConfig } from "@/lib/supabase/config";

import { open, parseKey, seal } from "./crypto";
import type { TravellerDetails } from "./offer";

// What the server keeps about a booking that must not go into the trip room: traveller details until the order
// exists, and the payment rows it trusts over anything a client says. Supabase with the server-only secret key
// (RLS on, no policies, so only this key reads it); without one, memory, which a restart empties.

export type PaymentStatus = "pending" | "held" | "captured" | "cancelled" | "failed";

export type PaymentRow = {
  roomId: string;
  legId: string;
  riderId: string;
  /** stripe: a Checkout session and its PaymentIntent. test: the no-charge checkout when Stripe isn't configured. */
  provider: "stripe" | "test";
  sessionId: string | null;
  paymentIntentId: string | null;
  amount: Money;
  status: PaymentStatus;
  /** When the card hold lapses, from Stripe; null until known. */
  captureBefore: string | null;
  /** Separate tickets: the Duffel offer this seat was priced against when the rider went to pay. */
  offerId: string | null;
  updatedAt: string;
};

export interface BookingStore {
  putTraveller(roomId: string, legId: string, riderId: string, details: TravellerDetails): Promise<void>;
  getTravellers(roomId: string, legId: string): Promise<Record<string, TravellerDetails>>;
  deleteTravellers(roomId: string, legId: string, riderId?: string): Promise<void>;
  upsertPayment(row: Omit<PaymentRow, "updatedAt">): Promise<void>;
  getPayment(roomId: string, legId: string, riderId: string): Promise<PaymentRow | null>;
  findPaymentBySession(sessionId: string): Promise<PaymentRow | null>;
  findPaymentByIntent(paymentIntentId: string): Promise<PaymentRow | null>;
  listPayments(roomId: string, legId: string): Promise<PaymentRow[]>;
  /** Takes a short lease on `key`, or false if someone holds it. The purchase runs under one so a retried webhook can't buy twice. */
  acquire(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

const paymentKey = (roomId: string, legId: string, riderId: string) => `${roomId}/${legId}/${riderId}`;

class MemoryStore implements BookingStore {
  travellers = new Map<string, TravellerDetails>();
  payments = new Map<string, PaymentRow>();
  leases = new Map<string, number>();

  async putTraveller(roomId: string, legId: string, riderId: string, details: TravellerDetails) {
    this.travellers.set(paymentKey(roomId, legId, riderId), details);
  }
  async getTravellers(roomId: string, legId: string) {
    const out: Record<string, TravellerDetails> = {};
    const prefix = `${roomId}/${legId}/`;
    for (const [key, t] of this.travellers) if (key.startsWith(prefix)) out[key.slice(prefix.length)] = t;
    return out;
  }
  async deleteTravellers(roomId: string, legId: string, riderId?: string) {
    if (riderId) this.travellers.delete(paymentKey(roomId, legId, riderId));
    else for (const key of [...this.travellers.keys()]) if (key.startsWith(`${roomId}/${legId}/`)) this.travellers.delete(key);
  }
  async upsertPayment(row: Omit<PaymentRow, "updatedAt">) {
    this.payments.set(paymentKey(row.roomId, row.legId, row.riderId), { ...row, updatedAt: new Date().toISOString() });
  }
  async getPayment(roomId: string, legId: string, riderId: string) {
    return this.payments.get(paymentKey(roomId, legId, riderId)) ?? null;
  }
  async findPaymentBySession(sessionId: string) {
    return [...this.payments.values()].find((p) => p.sessionId === sessionId) ?? null;
  }
  async findPaymentByIntent(paymentIntentId: string) {
    return [...this.payments.values()].find((p) => p.paymentIntentId === paymentIntentId) ?? null;
  }
  async listPayments(roomId: string, legId: string) {
    return [...this.payments.values()].filter((p) => p.roomId === roomId && p.legId === legId);
  }
  async acquire(key: string, ttlMs: number) {
    const until = this.leases.get(key);
    if (until && until > Date.now()) return false;
    this.leases.set(key, Date.now() + ttlMs);
    return true;
  }
  async release(key: string) {
    this.leases.delete(key);
  }
}

type PaymentRecord = {
  room_id: string;
  leg_id: string;
  rider_id: string;
  provider: "stripe" | "test";
  session_id: string | null;
  payment_intent_id: string | null;
  amount: number | string;
  currency: string;
  status: PaymentStatus;
  capture_before: string | null;
  offer_id: string | null;
  updated_at: string;
};

const fromRecord = (r: PaymentRecord): PaymentRow => ({
  roomId: r.room_id,
  legId: r.leg_id,
  riderId: r.rider_id,
  provider: r.provider,
  sessionId: r.session_id,
  paymentIntentId: r.payment_intent_id,
  amount: { amount: Number(r.amount), currency: r.currency },
  status: r.status,
  captureBefore: r.capture_before,
  offerId: r.offer_id,
  updatedAt: r.updated_at,
});

class SupabaseStore implements BookingStore {
  constructor(
    private readonly db: SupabaseClient,
    private readonly key: Buffer,
  ) {}

  private async run<T>(label: string, query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
    const { data, error } = await query;
    if (error) throw new Error(`[booking store] ${label}: ${error.message}`);
    return data;
  }

  async putTraveller(roomId: string, legId: string, riderId: string, details: TravellerDetails) {
    await this.run(
      "put traveller",
      this.db.from("booking_travellers").upsert({ room_id: roomId, leg_id: legId, rider_id: riderId, sealed: seal(JSON.stringify(details), this.key) }),
    );
  }
  async getTravellers(roomId: string, legId: string) {
    const rows = await this.run<{ rider_id: string; sealed: string }[] | null>(
      "get travellers",
      this.db.from("booking_travellers").select("rider_id, sealed").eq("room_id", roomId).eq("leg_id", legId),
    );
    const out: Record<string, TravellerDetails> = {};
    for (const row of rows ?? []) {
      const plain = open(row.sealed, this.key);
      if (plain) out[row.rider_id] = JSON.parse(plain) as TravellerDetails;
    }
    return out;
  }
  async deleteTravellers(roomId: string, legId: string, riderId?: string) {
    let q = this.db.from("booking_travellers").delete().eq("room_id", roomId).eq("leg_id", legId);
    if (riderId) q = q.eq("rider_id", riderId);
    await this.run("delete travellers", q);
  }
  async upsertPayment(row: Omit<PaymentRow, "updatedAt">) {
    await this.run(
      "upsert payment",
      this.db.from("booking_payments").upsert({
        room_id: row.roomId,
        leg_id: row.legId,
        rider_id: row.riderId,
        provider: row.provider,
        session_id: row.sessionId,
        payment_intent_id: row.paymentIntentId,
        amount: row.amount.amount,
        currency: row.amount.currency,
        status: row.status,
        capture_before: row.captureBefore,
        offer_id: row.offerId,
        updated_at: new Date().toISOString(),
      }),
    );
  }
  async getPayment(roomId: string, legId: string, riderId: string) {
    const row = await this.run<PaymentRecord | null>(
      "get payment",
      this.db.from("booking_payments").select("*").eq("room_id", roomId).eq("leg_id", legId).eq("rider_id", riderId).maybeSingle(),
    );
    return row ? fromRecord(row) : null;
  }
  async findPaymentBySession(sessionId: string) {
    const row = await this.run<PaymentRecord | null>("find by session", this.db.from("booking_payments").select("*").eq("session_id", sessionId).maybeSingle());
    return row ? fromRecord(row) : null;
  }
  async findPaymentByIntent(paymentIntentId: string) {
    const row = await this.run<PaymentRecord | null>("find by intent", this.db.from("booking_payments").select("*").eq("payment_intent_id", paymentIntentId).maybeSingle());
    return row ? fromRecord(row) : null;
  }
  async listPayments(roomId: string, legId: string) {
    const rows = await this.run<PaymentRecord[] | null>("list payments", this.db.from("booking_payments").select("*").eq("room_id", roomId).eq("leg_id", legId));
    return (rows ?? []).map(fromRecord);
  }
  async acquire(key: string, ttlMs: number) {
    // one row per key; the insert wins the lease, an expired lease is taken over
    const now = new Date();
    const until = new Date(now.getTime() + ttlMs).toISOString();
    const { error } = await this.db.from("booking_leases").insert({ key, expires_at: until });
    if (!error) return true;
    const { data } = await this.db.from("booking_leases").update({ expires_at: until }).eq("key", key).lt("expires_at", now.toISOString()).select("key");
    return !!data?.length;
  }
  async release(key: string) {
    await this.db.from("booking_leases").delete().eq("key", key);
  }
}

const globalStore = globalThis as unknown as { __bookingStore?: BookingStore };

/** The store for this server. Memory is a dev convenience; it logs once so nobody mistakes it for durable. */
export function bookingStore(): BookingStore {
  if (globalStore.__bookingStore) return globalStore.__bookingStore;
  const config = supabaseConfig();
  if (env.SUPABASE_SECRET_KEY && config) {
    if (!env.BOOKING_ENCRYPTION_KEY) throw new Error("BOOKING_ENCRYPTION_KEY is required with SUPABASE_SECRET_KEY: traveller details are sealed before they're stored.");
    const db = createClient(config.url, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    globalStore.__bookingStore = new SupabaseStore(db, parseKey(env.BOOKING_ENCRYPTION_KEY));
  } else {
    console.warn("[booking] SUPABASE_SECRET_KEY not set; traveller details and payments are kept in memory until restart.");
    globalStore.__bookingStore = new MemoryStore();
  }
  return globalStore.__bookingStore;
}

/** For tests: a fresh in-memory store. */
export const memoryBookingStore = (): BookingStore => new MemoryStore();
