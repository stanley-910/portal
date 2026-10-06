import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { savedCards, savedTraveller } from "@/lib/booking/flow";
import { env } from "@/lib/env.server";

// Pip books only on a rider's yes to a quote they've seen. Quoting returns a short reference Pip writes into its
// reply; booking takes it back. Nothing is stored: the reference is signed over what was quoted, so it only books those
// flights, at that price, on that card, for that rider, and only in a later turn than the quote's, after they answered.

/** How long a rider has to say yes before Pip has to quote again. */
export const QUOTE_TTL_MS = 30 * 60 * 1000;

/** What a rider agrees to: compared exactly, so any change in flights, price or card needs a fresh quote. */
export type QuoteTerms = { rider: string; leg: string; flights: string; price: string; card: string };

// without the booking key (local, in-memory store) a key per process still keeps references unforgeable
const fallbackKey = randomBytes(32);
const signingKey = () => (env.BOOKING_ENCRYPTION_KEY ? Buffer.from(`pip-quote:${env.BOOKING_ENCRYPTION_KEY}`) : fallbackKey);

const mac = (terms: QuoteTerms, expires: string, turn: string) =>
  createHmac("sha256", signingKey())
    .update([terms.rider, terms.leg, terms.flights, terms.price, terms.card, expires, turn].join("\n"))
    .digest("base64url")
    .replace(/[-_]/g, "")
    .slice(0, 8)
    .toUpperCase();

/** A short tag for the turn (the message being answered), so the reference stays short. */
const turnTag = (turn: string) => createHash("sha256").update(turn).digest("hex").slice(0, 4).toUpperCase();

/** "Q-TJ2K9X.7HQ2ZP4X.3FA0": expiry, signature and the turn it was quoted in. */
export function quoteRef(terms: QuoteTerms, turn: string, now = Date.now()): string {
  const expires = Math.ceil((now + QUOTE_TTL_MS) / 1000).toString(36).toUpperCase();
  const tag = turnTag(turn);
  return `Q-${expires}.${mac(terms, expires, tag)}.${tag}`;
}

export type QuoteCheck = "ok" | "malformed" | "expired" | "same_turn" | "changed";

/** Whether a reference covers exactly these terms, unexpired, from a turn before this one. */
export function checkQuote(ref: string, terms: QuoteTerms, turn: string, now = Date.now()): QuoteCheck {
  const match = /^Q-([0-9A-Z]+)\.([0-9A-Z]{8})\.([0-9A-F]{4})$/.exec(ref.trim().toUpperCase());
  if (!match) return "malformed";
  const [, expires, signature, quotedIn] = match;
  if (quotedIn === turnTag(turn)) return "same_turn";
  const expected = Buffer.from(mac(terms, expires, quotedIn));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "changed";
  if (parseInt(expires, 36) * 1000 < now) return "expired";
  return "ok";
}

/** The flights as a rider would check them: carrier, local date and times, and changes. */
export function flightsLine(o: { carrier: string | null; mode: string; depart: string; arrive: string; stops?: number }): string {
  const at = (iso: string) => iso.slice(0, 16).replace("T", " ");
  return `${o.carrier ?? o.mode}, departs ${at(o.depart)}, arrives ${at(o.arrive)}${o.stops ? `, ${o.stops} change${o.stops > 1 ? "s" : ""}` : ", direct"}`;
}

/** What the rider keeps on file for Pip to book with, as the quote shows it, and the card it would use. */
export async function onFile(personId: string): Promise<{ card: string; cardId: string; details: string }> {
  const [[card], details] = await Promise.all([savedCards(personId).catch(() => []), savedTraveller(personId).catch(() => null)]);
  return {
    card: card ? `${card.brand} ending ${card.last4}, expires ${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}` : "no saved card: they'd add one in the checkout card",
    cardId: card?.id ?? "none",
    details: details ? `saved for ${[details.givenName, details.familyName].filter(Boolean).join(" ")}${details.passport ? ", with a passport" : ""}` : "none saved: they'd enter them in the checkout card",
  };
}

/** What Pip shows and how it asks, the same in a shared trip and on the home globe. */
export const QUOTE_NOTE = (ref: string) =>
  `Nothing is booked or charged yet. Show them the flights, times, price and card above exactly, and ask them to reply yes to book. End your reply with the reference ${ref} on its own line. Don't book until they answer in a new message; then call book_leg again with confirm set to ${ref}. If they want changes, don't book.`;

/** Why a reference didn't book, for Pip to act on. */
export const QUOTE_REFUSAL: Record<Exclude<QuoteCheck, "ok">, string> = {
  same_turn: "You quoted this in this same turn: they haven't answered. Show the quote and wait for their reply.",
  malformed: "That isn't a quote reference. Show the quote below and ask again.",
  expired: "The quote expired. Show the fresh one below and ask again.",
  changed: "The flights, price or card changed since the quote, or it was for someone else. Show the fresh one below and ask again.",
};
