import type { StoredOffer } from "@/lib/liveblocks/types";
import { transfersOf, type Offer } from "@/lib/transport/types";

/** How many options a leg keeps. Rooms are capped at 10 MB, and nobody reads past this many. */
export const MAX_OFFERS = 20;

/** How many of each provider's best options a leg keeps before the rest fill by rank, so one provider's dozens of
 * fares can't crowd out the others (or the bookable ones). */
const PER_PROVIDER = 3;

/** A live Duffel fare: the only kind a trip can settle and buy in the app. Anything else is booked on its provider. */
export const isBookable = (offer: { provider: string; kind: string }) => offer.provider === "duffel" && offer.kind === "live";

/**
 * The options a leg keeps, in the search's ranked order: the pick (when given), each provider's best few, then the
 * rest by rank up to `max`.
 */
export function keepOffers<T extends { id: string; provider: string }>(ranked: readonly T[], pick?: string | null, max = MAX_OFFERS): T[] {
  const kept = new Set<T>();
  const picked = pick ? ranked.find((o) => o.id === pick) : undefined;
  if (picked) kept.add(picked);
  const perProvider = new Map<string, number>();
  for (const o of ranked) {
    if (kept.size >= max) break;
    const n = perProvider.get(o.provider) ?? 0;
    if (n >= PER_PROVIDER || kept.has(o)) continue;
    perProvider.set(o.provider, n + 1);
    kept.add(o);
  }
  for (const o of ranked) {
    if (kept.size >= max) break;
    kept.add(o);
  }
  return ranked.filter((o) => kept.has(o));
}

/** The options a leg shows: the first `n`, with the pick swapped in for the last when it's further down. */
export function shownOffers<T extends { id: string }>(offers: readonly T[], pick: string | null | undefined, n: number): T[] {
  const shown = offers.slice(0, n);
  const picked = pick ? offers.find((o) => o.id === pick) : undefined;
  if (picked && !shown.includes(picked)) shown[Math.max(0, shown.length - 1)] = picked;
  return shown;
}

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
    ...(offer.sandbox ? { sandbox: true } : {}),
    ...(offer.refund ? { refund: { fee: offer.refund.fee ? { amount: offer.refund.fee.amount, currency: offer.refund.fee.currency } : null } } : {}),
    price: offer.price ? { amount: offer.price.amount, currency: offer.price.currency } : null,
    carrier: first.carrier ?? null,
    ...(first.carrierCode ? { carrierCode: first.carrierCode } : {}),
    depart: first.depart,
    arrive: last.arrive,
    durationMin: Number.isFinite(span) && span > 0 ? Math.round(span) : offer.segments.reduce((sum, s) => sum + s.durationMin, 0),
    stops: transfersOf(offer),
    ...(offer.mode !== "flight" ? { departs: first.from.name, arrives: last.to.name } : {}),
    bookingUrl: webUrlOrNull(offer.bookingUrl),
    attribution: offer.attribution ?? null,
    ...flightsOf(offer),
  };
}

/** Flight numbers and airports, which settling needs to find the same flights again. Only when every segment has them. */
function flightsOf(offer: Offer): Pick<StoredOffer, "flights"> {
  const flights = offer.segments.map((s) =>
    s.number && s.from.iata && s.to.iata ? { number: s.number, from: s.from.iata, to: s.to.iata, depart: s.depart } : null,
  );
  return offer.mode === "flight" && flights.every((f) => f !== null) ? { flights: flights as NonNullable<StoredOffer["flights"]> } : {};
}

/** The badge's tooltip for a refundable fare: what a refund before departure costs. */
export function refundNote(offer: { refund?: { fee: { amount: number; currency: string } | null } }): string | undefined {
  if (!offer.refund) return undefined;
  const fee = offer.refund.fee;
  return fee ? `Refund before departure, ${fee.currency} ${fee.amount} fee per person` : "Free refund before departure";
}
