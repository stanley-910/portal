import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { bookingModes, formEncode, verifyStripeSignature } from "./stripe";

const secret = "whsec_test";
const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
const sign = (t: number, payload = body) => createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");

describe("verifyStripeSignature", () => {
  const now = 1_700_000_000;

  it("accepts a fresh v1 signature and ignores v0", () => {
    const header = `t=${now},v1=${sign(now)},v0=${"0".repeat(64)}`;
    expect(verifyStripeSignature(body, header, secret, now)?.type).toBe("checkout.session.completed");
  });

  it("accepts any of several v1 signatures, as during a secret roll", () => {
    const header = `t=${now},v1=${"a".repeat(64)},v1=${sign(now)}`;
    expect(verifyStripeSignature(body, header, secret, now)).not.toBeNull();
  });

  it("rejects a stale timestamp, a wrong secret, a changed body and a missing header", () => {
    expect(verifyStripeSignature(body, `t=${now - 301},v1=${sign(now - 301)}`, secret, now)).toBeNull();
    expect(verifyStripeSignature(body, `t=${now},v1=${sign(now)}`, "whsec_other", now)).toBeNull();
    expect(verifyStripeSignature(body + " ", `t=${now},v1=${sign(now)}`, secret, now)).toBeNull();
    expect(verifyStripeSignature(body, null, secret, now)).toBeNull();
    expect(verifyStripeSignature(body, `t=${now}`, secret, now)).toBeNull();
  });
});

describe("formEncode", () => {
  it("writes nested objects and arrays the way Stripe reads them", () => {
    const encoded = formEncode({
      mode: "payment",
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 1250 } }],
      payment_intent_data: { capture_method: "manual", metadata: { legId: "L1" } },
      expand: ["payment_intent"],
      skipped: undefined,
    }).toString();
    expect(decodeURIComponent(encoded)).toBe(
      "mode=payment&line_items[0][quantity]=1&line_items[0][price_data][currency]=usd&line_items[0][price_data][unit_amount]=1250&payment_intent_data[capture_method]=manual&payment_intent_data[metadata][legId]=L1&expand[0]=payment_intent",
    );
  });
});

describe("bookingModes", () => {
  it("books only when the airline and the cards are in the same mode", () => {
    expect(bookingModes("duffel_test_x", "sk_test_x")).toEqual({ ok: true, mode: "test" });
    expect(bookingModes("duffel_live_x", "sk_live_x")).toEqual({ ok: true, mode: "live" });
    expect(bookingModes("duffel_live_x", "rk_live_x")).toEqual({ ok: true, mode: "live" });
    expect(bookingModes("duffel_live_x", "sk_test_x").ok).toBe(false);
    expect(bookingModes("duffel_test_x", "sk_live_x").ok).toBe(false);
  });
  it("runs the no-charge checkout only on test fares", () => {
    expect(bookingModes("duffel_test_x", undefined)).toEqual({ ok: true, mode: "test" });
    expect(bookingModes("duffel_live_x", undefined).ok).toBe(false);
    expect(bookingModes(undefined, "sk_test_x").ok).toBe(false);
  });
});
