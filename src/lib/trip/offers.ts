import type { StoredOffer } from "@/lib/liveblocks/types";
import { transfersOf, type Offer } from "@/lib/transport/types";

/** How many options a leg keeps. Rooms are capped at 10 MB, and nobody reads past this many. */
export const MAX_OFFERS = 20;

/** Only web links: rooms render `bookingUrl` as a link, so a `javascript:` or `data:` URL must never be stored. */
export function webUrlOrNull(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol) ? value : null;
  } catch {
    return null;
  }
}

/** Trims a search result to what the plan shows. */
export function toStoredOffer(offer: Offer): StoredOffer {
  const first = offer.segments[0]!;
  const last = offer.segments.at(-1)!;
  // door to door, so connections count; providers' per-segment durations leave out the wait between them
  const span = (Date.parse(last.arrive) - Date.parse(first.depart)) / 60_000;
  return {
    id: offer.id,
    provider: offer.provider,
    mode: offer.mode,
    kind: offer.kind,
    price: offer.price ? { amount: offer.price.amount, currency: offer.price.currency } : null,
    carrier: first.carrier ?? null,
    depart: first.depart,
    arrive: last.arrive,
    durationMin: Number.isFinite(span) && span > 0 ? Math.round(span) : offer.segments.reduce((sum, s) => sum + s.durationMin, 0),
    stops: transfersOf(offer),
    bookingUrl: webUrlOrNull(offer.bookingUrl),
    attribution: offer.attribution ?? null,
  };
}
