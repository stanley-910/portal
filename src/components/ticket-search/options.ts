import { convertCurrency, type Currency, type ExchangeRates } from "@/lib/currency";
import { transfersOf, type Mode, type Offer } from "@/lib/transport/types";

// Turns search offers into what the ticket search popover shows: tabs, the top three rows per tab, and each row's
// leg timeline. Pure, so it can be tested without the globe.

export type Tab = "best" | Mode;

export const TABS: { id: Tab; label: string }[] = [
  { id: "best", label: "Best" },
  { id: "flight", label: "Flights" },
  { id: "train", label: "Trains" },
  { id: "bus", label: "Buses" },
  { id: "ferry", label: "Boats" },
];

export const SHOWN = 3;

export interface TimelineLeg {
  kind: Mode | "wait";
  minutes: number;
  /** Tooltip, e.g. "Flight 10h 10m" or "Layover 1h 45m in Addis Ababa". */
  label: string;
}

export interface OptionRow {
  offer: Offer;
  /** Total duration on Best; departure and arrival times on a mode tab when both are local. */
  headline: string;
  badge?: "Best" | "Lowest";
  /** Not live data (AGENTS.md: anything that isn't live shows as estimated). */
  estimated: boolean;
  /** Who runs it and where it goes, e.g. "Flight to Seoul Gimpo, 1 stop". The provider's credit goes under the list. */
  description: string;
  legs: TimelineLeg[];
  /** Where the data came from, in full, for the row's tooltip. */
  source: string;
}

/** "19h 55m", "55m" */
export function duration(min: number): string {
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}

const NOUN: Record<Mode, string> = { flight: "flight", train: "train", bus: "bus", ferry: "ferry" };
const LEG_LABEL: Record<Mode, string> = { flight: "Flight", train: "Train", bus: "Bus", ferry: "Ferry" };
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Seoul Gimpo International Airport" → "Seoul Gimpo". Rows name the place; the code and full name are on the ticket. */
export function shortPlace(name: string): string {
  return name.replace(/\s+(International\s+)?Airport$/i, "").trim() || name;
}

/** The moving legs and the layovers between them. A gap that can't be worked out (bad or mixed time zones) is left out. */
export function timeline(offer: Offer): TimelineLeg[] {
  const legs: TimelineLeg[] = [];
  offer.segments.forEach((s, i) => {
    if (i > 0) {
      const prev = offer.segments[i - 1];
      const wait = Math.round((Date.parse(s.depart) - Date.parse(prev.arrive)) / 60_000);
      if (Number.isFinite(wait) && wait > 0 && wait < 48 * 60) {
        legs.push({ kind: "wait", minutes: wait, label: `Layover ${duration(wait)} in ${shortPlace(s.from.name)}` });
      }
    }
    legs.push({ kind: s.mode, minutes: s.durationMin, label: `${LEG_LABEL[s.mode]} ${duration(s.durationMin)}` });
  });
  return legs;
}

export const totalMinutes = (offer: Offer) => timeline(offer).reduce((sum, l) => sum + l.minutes, 0);

/** Wall-clock "HH:MM" and date as the provider wrote them, or null when the time is in UTC rather than local. */
function wallClock(iso: string): { time: string; day: number } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  if (!m || /Z$/i.test(iso)) return null;
  return { time: m[2], day: Date.parse(`${m[1]}T00:00:00Z`) / 86_400_000 };
}

/** "23:10 – 18:50 +1", "Leaves 08:15" when the arrival isn't in local time, or the duration when neither is. */
function times(offer: Offer): string {
  // a modelled option has no schedule, only a typical duration
  if (offer.kind === "estimated") return duration(totalMinutes(offer));
  const first = offer.segments[0];
  const last = offer.segments[offer.segments.length - 1];
  const dep = wallClock(first.depart);
  if (!dep) return duration(totalMinutes(offer));
  const arr = wallClock(last.arrive);
  if (!arr) return `Leaves ${dep.time}`;
  const days = arr.day - dep.day;
  return `${dep.time} – ${arr.time}${days > 0 ? ` +${days}` : ""}`;
}

/** "Ethiopian", or "CX flight" for a bare code, or "Flight" with no carrier. */
export function carrierLabel(carrier: string | null | undefined, mode: Mode): string {
  const c = carrier?.trim();
  // a bare code ("CX", "G") reads better with the mode after it
  return c ? (c.length <= 3 ? `${c} ${NOUN[mode]}` : c) : capital(NOUN[mode]);
}

/** "Ethiopian via Addis Ababa to Lagos", "CX flight to Shanghai", "Train G2 to Beijing South, leaves 07:00". */
function describe(offer: Offer, tab: Tab): string {
  const first = offer.segments[0];
  const last = offer.segments[offer.segments.length - 1];
  // a timetable train has a number but no operator: "Train G2" tells the rows apart
  const who = !first.carrier && first.number ? `${capital(NOUN[offer.mode])} ${first.number}` : carrierLabel(first.carrier, offer.mode);
  const stops = offer.segments.slice(1).map((s) => shortPlace(s.from.name));
  const via = stops.length ? ` via ${stops.join(" and ")}` : "";
  const parts = [`${who}${via} to ${shortPlace(last.to.name)}`];
  // cached fares count their connections without listing them, so say how many instead of where
  const unlisted = transfersOf(offer);
  if (!stops.length && unlisted) parts.push(`${unlisted} stop${unlisted > 1 ? "s" : ""}`);
  if (tab !== "best") parts.push(duration(totalMinutes(offer)));
  // Best's headline is the duration, so say when it leaves
  const dep = wallClock(first.depart);
  if (tab === "best" && dep && offer.kind !== "estimated") parts.push(`leaves ${dep.time}`);
  return parts.join(", ");
}

export interface Credit {
  /** "Travelpayouts / Aviasales" */
  label: string;
  /** The source's own page for a shown row, the selected one first. */
  url?: string;
}

/**
 * The credits a provider's terms want near its results, once each for the rows shown, linked to the source.
 * What follows a " — " qualifies the fare, which the Estimated badge and the row's tooltip already say.
 */
export function credits(rows: OptionRow[], selected?: OptionRow): Credit[] {
  const out = new Map<string, Credit>();
  for (const r of selected ? [selected, ...rows] : rows) {
    const label = r.offer.attribution?.split(" — ")[0].trim();
    if (!label) continue;
    const credit = out.get(label) ?? { label };
    credit.url ??= r.offer.bookingUrl;
    out.set(label, credit);
  }
  return [...out.values()];
}

const SOURCE: Record<Offer["kind"], string> = {
  live: "live",
  cached: "cached",
  timetable: "timetable, no live fare",
  estimated: "modelled fare, schedule unverified",
};

/** One-way price in USD for ranking, or null without a price or a rate. */
export function usd(offer: Offer, rates: ExchangeRates | null): number | null {
  if (!offer.price) return null;
  if (offer.price.currency === "USD") return offer.price.amount;
  return rates ? convertCurrency(offer.price.amount, offer.price.currency, "USD", rates) : null;
}

/** The offers listed under a tab, in the search's ranked order. Best mixes every mode. */
export function offersFor(offers: Offer[], tab: Tab): Offer[] {
  return tab === "best" ? offers : offers.filter((o) => o.mode === tab);
}

/** Best, then the modes that have at least one result. */
export function visibleTabs(offers: Offer[]): Tab[] {
  return TABS.filter((t) => t.id === "best" || offers.some((o) => o.mode === t.id)).map((t) => t.id);
}

/**
 * The top rows for a tab: the best-ranked option, then the cheapest if it isn't already first, then the rest in
 * ranked order. `offers` must already be ranked best first (the search API does this).
 */
export function rowsFor(offers: Offer[], tab: Tab, rates: ExchangeRates | null): OptionRow[] {
  const list = offersFor(offers, tab);
  if (!list.length) return [];
  let cheapest: Offer | null = null;
  let low = Number.POSITIVE_INFINITY;
  for (const o of list) {
    const price = usd(o, rates);
    if (price !== null && price < low) {
      low = price;
      cheapest = o;
    }
  }
  const best = list[0];
  const picked = [best];
  if (cheapest && cheapest !== best) picked.push(cheapest);
  for (const o of list) {
    if (picked.length >= SHOWN) break;
    if (!picked.includes(o)) picked.push(o);
  }
  return picked.map((offer) => ({
    offer,
    headline: tab === "best" ? duration(totalMinutes(offer)) : times(offer),
    badge: offer === best ? "Best" : offer === cheapest ? "Lowest" : undefined,
    estimated: offer.kind !== "live",
    description: describe(offer, tab),
    legs: timeline(offer),
    source: `From ${offer.provider}, ${SOURCE[offer.kind]}${offer.attribution ? `. ${offer.attribution}` : ""}`,
  }));
}

/** An option's fare in the viewer's currency. Null when it has no fare or there's no exchange rate for it. */
export function rowPrice(offer: Offer, currency: Currency, rates: ExchangeRates | null): number | null {
  if (!offer.price) return null;
  if (offer.price.currency === currency) return offer.price.amount;
  return rates ? convertCurrency(offer.price.amount, offer.price.currency, currency, rates) : null;
}

/** A round trip's fare: the picked way out plus the picked way back. Null when either has no fare. */
export function tripPrice(offers: Offer[], currency: Currency, rates: ExchangeRates | null): number | null {
  let total = 0;
  for (const offer of offers) {
    const price = rowPrice(offer, currency, rates);
    if (price === null) return null;
    total += price;
  }
  return offers.length ? total : null;
}

/** "$905", "HK$7,050", "€84" */
export function formatPrice(amount: number, currency: Currency): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}
