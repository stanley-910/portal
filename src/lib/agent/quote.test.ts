import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env.server", () => ({ env: { BOOKING_ENCRYPTION_KEY: "test-key" } }));
vi.mock("@/lib/booking/flow", () => ({ savedCards: vi.fn(), savedTraveller: vi.fn() }));

import { checkQuote, QUOTE_TTL_MS, quoteRef, type QuoteTerms } from "./quote";

const terms: QuoteTerms = { rider: "m1", leg: "leg1", flights: "EVA Air, departs 2026-10-06 16:20, arrives 2026-10-06 20:20, direct", price: "USD 347", card: "pm_1" };
const at = Date.parse("2026-10-06T08:00:00Z");

describe("booking quotes", () => {
  it("books only in a later turn than the quote, on exactly what was quoted", () => {
    const ref = quoteRef(terms, "msg-1", at);
    expect(checkQuote(ref, terms, "msg-2", at + 60_000)).toBe("ok");
    expect(checkQuote(ref.toLowerCase(), terms, "msg-2", at + 60_000)).toBe("ok");
  });

  it("refuses a quote used in the turn it was given, before they could answer", () => {
    expect(checkQuote(quoteRef(terms, "msg-1", at), terms, "msg-1", at)).toBe("same_turn");
  });

  it("refuses when the flights, price, card or rider changed", () => {
    const ref = quoteRef(terms, "msg-1", at);
    for (const change of [{ price: "USD 399" }, { card: "none" }, { rider: "m2" }, { flights: "EVA Air, departs 2026-10-06 18:00" }, { leg: "leg2" }]) {
      expect(checkQuote(ref, { ...terms, ...change }, "msg-2", at)).toBe("changed");
    }
  });

  it("refuses an expired, forged or garbled reference", () => {
    const ref = quoteRef(terms, "msg-1", at);
    expect(checkQuote(ref, terms, "msg-2", at + QUOTE_TTL_MS + 1_000)).toBe("expired");
    const [head, , tag] = ref.split(".");
    expect(checkQuote(`${head}.AAAAAAAA.${tag}`, terms, "msg-2", at)).toBe("changed");
    // a later expiry can't be written in without the signature breaking
    expect(checkQuote(`Q-ZZZZZZZ.${ref.split(".")[1]}.${tag}`, terms, "msg-2", at)).toBe("changed");
    expect(checkQuote("yes", terms, "msg-2", at)).toBe("malformed");
  });
});
