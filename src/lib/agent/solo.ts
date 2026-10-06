import { NEARBY_RAIL_INSTRUCTION, railPreferences, searchNearbyRail } from "./nearby-rail";
import { describeRoutes, optimize, OPTIMIZE_INSTRUCTION } from "./optimize";
import "server-only";

import { deepseek } from "@ai-sdk/deepseek";
import { isStepCount, streamText, tool, type TextStreamPart, type ToolSet } from "ai";
import { z } from "zod";

import { dateIn } from "@/lib/agent/dates";
import { clockOfIso } from "@/lib/clock";
import { resolvePlace } from "@/lib/agent/edit";
import { legEntry, OFFICIAL_ENTRY_REMINDER } from "@/lib/agent/entry";
import { legMarks, midpoint, type AgentMark } from "@/lib/agent/marks";
import { findMeetup, MAX_MEETUP_GROUPS, type MeetupGroup } from "@/lib/agent/meetup";
import { citiesIn, MODEL } from "@/lib/agent/run";
import { prepareEffort } from "@/lib/agent/effort";
import { showDate } from "@/lib/agent/snapshot";
import { GLOBE_TOOLS, stepLabel } from "@/lib/agent/steps";
import { fmt, KIND } from "@/lib/agent/tools";
import { AGENT_NAME, type MeetupOption, type ThreadCard } from "@/lib/agent/types";
import { PERSONA, STYLE } from "@/lib/agent/voice";
import type { Stop } from "@/lib/liveblocks/types";
import { countryName } from "@/lib/nationality";
import { searchFromCoordinates } from "@/lib/transport/hub-search";
import { isBookable, toStoredOffer } from "@/lib/trip/offers";
import { soloSaveInput } from "@/lib/trip/solo-input";
import { saveSoloTrip } from "@/app/t/save-actions";
import { bookWithSaved, settleLeg } from "@/lib/booking/flow";
import { checkQuote, flightsLine, onFile, QUOTE_NOTE, QUOTE_REFUSAL, quoteRef, type QuoteTerms } from "@/lib/agent/quote";
import { getAccountClaims } from "@/lib/supabase/server";
import { tripRoomId } from "@/lib/liveblocks/types";
import { seatNote } from "@/lib/agent/tools";
import type { Offer } from "@/lib/transport/types";
import { stopToPlace } from "@/lib/trip/stops";

// Pip on the home globe, before there's a trip: no room, no session. The browser sends the conversation and the
// legs on its globe; Pip answers in a stream of events the browser applies itself. Planned legs land on that
// globe, where the trip card searches fares, and Save trip keeps them in the person's account.

/** One event in the reply stream, sent as a line of JSON. `at` is how far the text had got. */
export type SoloEvent =
  | { t: "text"; d: string }
  | { t: "card"; card: ThreadCard }
  /** A tool call's line in the reply; `globe` when its work shows on the globe. */
  | { t: "step"; id: string; label: string; done: boolean; at: number; globe?: boolean }
  /** What Pip is doing, and where on the globe; the saucer goes there. */
  | { t: "activity"; label: string | null; at?: { lat: number; lng: number } }
  | { t: "trip"; legs: SoloLeg[] }
  /** What plan_trip changed on their globe, to pop up where it happened. */
  | { t: "marks"; marks: AgentMark[] }
  | { t: "done" }
  | { t: "failed" };

export type SoloLeg = { from: Stop; to: Stop; date: string };

const MAX_STEPS = 6;
/** Per model call, hidden reasoning included: see MAX_OUTPUT_TOKENS in run.ts for the sizing. */
const MAX_OUTPUT_TOKENS = 6_000;
/**
 * The whole reply. Most finish in under 15 s with reasoning effort "high"; this leaves room for a slow multi-step one,
 * and the no-model fallback still fits inside the route's maxDuration (app/api/pip/route.ts) after it.
 */
export const TIMEOUT_MS = 80_000;

const SYSTEM = `You are ${AGENT_NAME}, the travel agent inside Portal, a globe where people plan how to get between places in Asia.
You're talking to one person on their own globe, before they've saved a trip. Their globe shows whatever legs are on it now.

${PERSONA}

What you do: work out how to get between places. Put legs on their globe, search routes and fares, find where people coming from different places should meet.
What you don't do: itineraries, sights, hotels, restaurants or reviews. Say so in one sentence if asked.
You can book a leg for them in the app once they've said yes to your quote, as Pip does in a shared trip; you can't enter their details or pay for them.

How to work:
- Whenever a message names where they're going and it isn't on their globe yet, call plan_trip first, straight away, with the stops in order and a date per leg: it puts the legs on their globe and each leg's card searches fares. Never ask whether to put it on the globe. If they give no date, use tomorrow and say so.
- A return or round trip is just one more leg back to where they started. Call plan_trip with the trip's stops (the ones on their globe, or the ones they name) and the first stop again at the end, the return date as that last leg's date. "How do I get back?" means the same: keep the legs they have and add the one home.
- Then, in the same turn: for the cheapest way, a budget or something cheaper, call optimize_route; for plain fares or times, call search_routes.
- To talk about fares or times, call search_routes and quote it exactly; say when a price is estimated. Never estimate fares, distances or durations yourself.
- ${OPTIMIZE_INSTRUCTION} Here that's optimize_route. If they say yes to a via route, call plan_trip with the via station added as a stop between the two.
- ${NEARBY_RAIL_INSTRUCTION}
- For visa, passport or entry questions, call check_entry for each leg it's about (by its number on their globe), or for a place they name. It covers every passport they've saved. Never answer one from memory. Name the passport each requirement applies to ("on your US passport you need a visa; on your Canadian one it's visa-free for 30 days"). When their passports differ, say plainly which needs a visa or document and which doesn't, and which to travel on. If they've saved no passport, say so: they add them under Passports in the profile menu. Mention estimated rules as estimates, and end with the official-source reminder.
- For "where should we meet", call find_meetup. Its card has a button that puts their own leg on the globe.
- Dates: resolve "the 14th" or "next Friday" against today's date to YYYY-MM-DD.
- When they ask to book, call book_leg without confirm, with the leg's number and the option's number from search_routes if they named one (only options marked bookable; without one it takes the cheapest bookable fare). It books nothing: it returns a quote. Show them the flights, departure and arrival times, price, and the card and details it would use, ask them to reply yes, and end with its reference. Never book in the same reply, even if they said "just book it" or asked you to check something first; every booking waits for their yes in a new message. When they say yes, call book_leg again with the same leg and option and confirm set to the reference: it saves the leg as a trip in their account and books their seat, and the checkout card it posts shows where it stands without leaving the globe. If it failed, say so plainly, never that it's booked or held. Never say you can't book. Fares marked estimated, cached or timetable can't be bought in the app: say so and offer a bookable one.
- To keep a trip or bring friends in, they press Save trip on the card; once saved it's in their trips, and its link invites friends.
- If a tool refuses, follow its "next" hint, or ask the one question you need.
- Get every number from tools before you write; your words stream as you write them, so never correct yourself mid-reply.
- ${STYLE}`;

const date = z.string().describe("YYYY-MM-DD");

/** A place name to a stop, or the refusal the model should act on. */
function place(name: string) {
  const r = resolvePlace(name);
  return "refusal" in r ? { refused: r.refusal.code, reason: r.refusal.reason, next: r.refusal.next } : r.stop;
}

/** Options listed per search, numbered for book_leg. */
const MAX_OPTIONS = 8;

/** A search's options cheapest first, numbered the same way by search_routes and book_leg. */
function rankedOptions(offers: Offer[]): { offer: Offer; stored: ReturnType<typeof toStoredOffer> }[] {
  const price = (o: ReturnType<typeof toStoredOffer>) => (o.price ? o.price.amount * (usd[o.price.currency] ?? Infinity) : Infinity);
  return offers.map((offer) => ({ offer, stored: toStoredOffer(offer) }))
    .sort((x, y) => price(x.stored) - price(y.stored) || x.offer.id.localeCompare(y.offer.id)).slice(0, MAX_OPTIONS);
}

const usd: Record<string, number> = { USD: 1, CNY: 0.138, HKD: 0.128, JPY: 0.0067, KRW: 0.00072, TWD: 0.031, THB: 0.028, MYR: 0.21, SGD: 0.74, EUR: 1.08, CAD: 0.73 };

type Emit = (event: SoloEvent) => void;

/** What one reply's tools share: the legs on the globe now (plan_trip replaces them) and the person's passports. */
/** `turn` names the message being answered: a booking quote only counts in a later one. */
type SoloState = { trip: SoloLeg[]; nationalities: string[]; meetups: Map<string, MeetupOption>; turn: string };

function soloTools(emit: Emit, textAt: () => number, state: SoloState, signal: AbortSignal) {
  const { meetups } = state;
  return {
    plan_trip: tool({
      description:
        "Puts a trip on their globe: the stops in order, one leg between each pair, each on its date. Replaces what's there. Each leg's card then searches fares for them to pick from. For a round trip, repeat the first stop at the end.",
      inputSchema: z.object({
        stops: z.array(z.string().describe("A city, airport or station, e.g. Hong Kong or Beijing Daxing")).min(2).max(6),
        dates: z.array(date).min(1).describe("One per leg, in order; a missing one is the day after the last"),
      }),
      execute: async ({ stops, dates }) => {
        const places = stops.map(place);
        const bad = places.find((p) => "refused" in p);
        if (bad) return bad;
        const resolved = places as Stop[];
        const legs: SoloLeg[] = resolved.slice(1).map((to, i) => {
          const day = dates[i] ?? nextDay(dates[dates.length - 1], i - dates.length + 1);
          return { from: resolved[i], to, date: day };
        });
        signal.throwIfAborted();
        // Animation is presentation: the browser queues the marks while fares and the model continue.
        emit({ t: "trip", legs });
        emit({ t: "marks", marks: legMarks(state.trip, legs) });
        state.trip = legs;
        return {
          onGlobe: legs.map((l) => `${l.from.name} → ${l.to.name} on ${showDate(l.date)}`),
          note: "Each leg's card is searching fares now. Don't quote fares unless you call search_routes.",
        };
      },
    }),

    search_routes: tool({
      description: "Routes between two places on a date, cheapest first, with times and how fresh each price is. Quote them exactly.",
      inputSchema: z.object({ from: z.string(), to: z.string(), date }),
      execute: async ({ from, to, date: day }) => {
        const a = place(from);
        const b = place(to);
        if ("refused" in a) return a;
        if ("refused" in b) return b;
        emit({ t: "activity", label: `checking ${a.name} to ${b.name}`, at: midpoint(a, b) });
        const result = await searchFromCoordinates(
          { from: stopToPlace(a), to: stopToPlace(b), date: day, modes: [], passengers: 1, currency: "USD" },
          AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        ).catch(() => null);
        emit({ t: "activity", label: null });
        if (!result) return { refused: "SEARCH_FAILED", reason: "The search didn't come back.", next: "Say so; the trip card searches too." };
        return {
          found: result.offers.length,
          options: rankedOptions(result.offers).map(({ stored: o }, i) => {
            const cost = o.price ? `${o.price.currency} ${Math.round(o.price.amount)}` : "no price";
            const time = o.kind === "estimated" ? "time unknown" : `${clockOfIso(o.depart)}→${clockOfIso(o.arrive)}`;
            const extras = [isBookable(o) ? "bookable" : "", o.refund ? (o.refund.fee ? `refundable for a ${o.refund.fee.currency} ${o.refund.fee.amount} fee` : "refundable free") : ""].filter(Boolean).join(", ");
            return `${i + 1}. ${o.mode}${o.carrier ? ` ${o.carrier}` : ""} ${time}, ${Math.floor(o.durationMin / 60)}h${String(o.durationMin % 60).padStart(2, "0")}, ${cost} (${KIND[o.kind]})${extras ? `, ${extras}` : ""}`;
          }),
        };
      },
    }),

    book_leg: tool({
      description:
        "Books one leg on their globe in the app, in two steps. Without confirm it books nothing and returns a quote: the flights, times, price, and their saved card and details, with a reference. Show them that and wait for their yes in a new message; then call again with the same leg and option and confirm set to the reference, which saves the leg as a trip in their account, settles it at today's fare and books their seat with their saved details and card, then posts a checkout card showing where it stands and anything left for them. Only fares marked bookable can be bought.",
      inputSchema: z.object({
        leg: z.number().int().min(1).describe("The leg's number on their globe"),
        option: z.number().int().min(1).max(MAX_OPTIONS).optional().describe("The option's number from search_routes for this leg, when they named one; omit for the cheapest bookable fare"),
        confirm: z.string().optional().describe("The quote reference from your earlier message, once they've said yes to it in a new message"),
      }),
      execute: async ({ leg, option, confirm }) => {
        const onGlobe = state.trip[leg - 1];
        if (!onGlobe) return { refused: "UNKNOWN_LEG", next: `They have ${state.trip.length} legs; use one of those numbers.` };
        const account = await getAccountClaims();
        if (!account) return { refused: "SIGNED_OUT", next: "Say they need to sign in to book in the app." };
        emit({ t: "activity", label: "checking bookable fares", at: midpoint(onGlobe.from, onGlobe.to) });
        try {
          const result = await searchFromCoordinates(
            { from: stopToPlace(onGlobe.from), to: stopToPlace(onGlobe.to), date: onGlobe.date, modes: [], passengers: 1, currency: "USD" },
            AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          ).catch(() => null);
          if (!result) return { refused: "SEARCH_FAILED", next: "Say the search didn't come back; they can press Book on the leg's card." };
          const options = rankedOptions(result.offers);
          const pick = option ? options[option - 1] : options.find((o) => isBookable(o.stored));
          if (!pick) return { refused: option ? "UNKNOWN_OPTION" : "NOTHING_BOOKABLE", next: option ? "Call search_routes and use its numbers." : "Say no fare on this leg can be bought in the app; the estimated ones book on the provider's site." };
          if (!isBookable(pick.stored)) return { refused: "NOT_BOOKABLE", next: "Say that fare can't be bought in the app, and offer a bookable one." };
          const o = pick.stored;
          const flights = flightsLine(o);
          const price = o.price ? `${o.price.currency} ${o.price.amount}` : "price at checkout";
          const file = await onFile(account.id);
          const terms: QuoteTerms = { rider: account.id, leg: `${onGlobe.from.name}→${onGlobe.to.name} ${onGlobe.date}`, flights, price, card: file.cardId };
          const check = confirm ? checkQuote(confirm, terms, state.turn) : null;
          if (check !== "ok") {
            const ref = quoteRef(terms, state.turn);
            return { status: "QUOTE", ...(check ? { not_booked: QUOTE_REFUSAL[check] } : {}), quote: { leg, flights, price, card: file.card, details: file.details }, reference: ref, note: QUOTE_NOTE(ref) };
          }
          emit({ t: "activity", label: "saving your trip", at: { lat: onGlobe.from.lat, lng: onGlobe.from.lng } });
          const saved = await saveSoloTrip(soloSaveInput(
            [{ from: onGlobe.from, to: onGlobe.to }],
            [{ offer: pick.offer, offers: options.map((x) => x.offer), depart: onGlobe.date, stay: null }],
          )).catch(() => ({ error: "failed" as const }));
          if ("error" in saved || !saved.legs[0]) return { refused: "SAVE_FAILED", next: "Say saving the trip failed; they can try Book on the leg's card." };
          // they said yes to this quote: settle at today's fare, then their seat with what they keep on file
          emit({ t: "activity", label: "booking your seat", at: { lat: onGlobe.to.lat, lng: onGlobe.to.lng } });
          const roomId = tripRoomId(saved.id), legId = saved.legs[0];
          const actor = { id: account.id, name: account.name, email: account.email };
          let seat: string, failed = false;
          const settled = await settleLeg(roomId, legId, actor);
          if (!settled.ok && "now" in settled) seat = "not booked: the fare moved since the quote, and the card shows the new price to accept";
          else if (!settled.ok) return { refused: settled.code, reason: settled.message, next: settled.code === "OFFER_GONE" ? "Say that fare is gone and offer the next bookable option." : "Tell them plainly that nothing was booked." };
          else {
            const own = await bookWithSaved(roomId, legId, actor);
            failed = !own.ok;
            seat = seatNote(own);
          }
          emit({ t: "card", card: { type: "checkout", legId, tripId: saved.id } });
          return {
            status: failed ? "not_booked" : "checkout_up",
            fare: `${flights}, ${price}`,
            your_seat: seat,
            note: failed
              ? "It didn't go through: say so plainly with the reason, and that nobody was charged. Never say it's booked or held."
              : "The checkout card is in the chat with where it stands; the leg is saved in their trips. Say in a sentence what happened to their seat; don't repeat the card.",
          };
        } finally {
          emit({ t: "activity", label: null });
        }
      },
    }),

    optimize_route: tool({
      description:
        "Finds cheaper or better-timed ways to make one leg: the direct options, and routes that first get to a nearby station or airport (by metro and a border crossing, a short train, or an estimated ground transfer) and go on from there, overnight if need be, with connections chained and totals added up. Use it whenever a leg is too expensive, they give a budget, want it cheaper, or want to arrive when someone else does.",
      inputSchema: z.object({
        leg: z.number().int().min(1).optional().describe("The leg's number on their globe"),
        from: z.string().optional().describe("Or where from, with to and date"),
        to: z.string().optional(),
        date: date.optional(),
        max_fare: z.number().positive().optional().describe("Per-person ceiling in `currency`, only if they gave a number"),
        currency: z.string().regex(/^[A-Z]{3}$/).default("USD").describe("The currency they talk in, e.g. CNY or HKD"),
        arrive_near: z.string().optional().describe("A time to arrive close to, e.g. when a friend gets in: 2026-10-20T19:30 local where they arrive"),
      }),
      execute: async (input) => {
        const onGlobe = input.leg ? state.trip[input.leg - 1] : undefined;
        if (input.leg && !onGlobe) return { refused: "UNKNOWN_LEG", next: `They have ${state.trip.length} legs; use one of those numbers.` };
        const a = onGlobe?.from ?? (input.from ? place(input.from) : undefined);
        const b = onGlobe?.to ?? (input.to ? place(input.to) : undefined);
        const day = onGlobe?.date ?? input.date;
        if (!a || !b || !day) return { refused: "MISSING", next: "Give a leg number, or from, to and date." };
        if ("refused" in a) return a;
        if ("refused" in b) return b;
        emit({ t: "activity", label: "looking for a cheaper way", at: { lat: a.lat, lng: a.lng } });
        try {
          const composed = await optimize({ from: stopToPlace(a), to: stopToPlace(b), date: day, currency: input.currency,
            maxFare: input.max_fare, arriveNear: input.arrive_near }, AbortSignal.timeout(20_000));
          const out = describeRoutes(composed);
          return { ...out, note: `${out.note} To take a via route, call plan_trip with the via station added as a stop.` };
        } catch {
          return { refused: "SEARCH_FAILED", next: "Say the search failed; don't guess fares." };
        } finally { emit({ t: "activity", label: null }); }
      },
    }),

    search_nearby_trains: tool({
      description: "Search train alternatives around both endpoints, including adjacent cities, for cheaper travel or missing trains. Returns actual station names and access distances without changing the trip.",
      inputSchema: z.object({ from: z.string(), to: z.string(), date, ...railPreferences }),
      execute: async ({ from, to, date: day, ...preferences }) => {
        const a = place(from), b = place(to);
        if ("refused" in a) return a;
        if ("refused" in b) return b;
        emit({ t: "activity", label: "checking nearby train stations" });
        try {
          return await searchNearbyRail({ from: stopToPlace(a), to: stopToPlace(b), date: day,
            modes: ["train"], passengers: 1, currency: preferences.currency }, preferences, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
        } catch { return { refused: "SEARCH_FAILED", next: "Say the nearby rail search failed; do not infer that no trains exist." }; }
        finally { emit({ t: "activity", label: null }); }
      },
    }),

    check_entry: tool({
      description:
        "Entry rules for every passport they've saved, on one leg of their globe or for a place they name: what each passport needs (visa-free, e-visa, visa, permit), for how long, conditions, a transit option, official sources and how fresh it is, with the easiest passport marked. Use it for any visa, entry or passport question; never answer one from memory.",
      inputSchema: z.object({
        leg: z.number().int().min(1).optional().describe("The leg's number on their globe, e.g. 1"),
        to: z.string().optional().describe("Or a place they name that isn't on the globe, e.g. Tokyo"),
        from: z.string().optional().describe("Where they come from, with to"),
      }),
      execute: async ({ leg, to, from }) => {
        if (!state.nationalities.length) {
          return { status: "passport_not_provided", next: "Say they haven't saved a passport; they add them under Passports in the profile menu, then ask again." };
        }
        let a: Stop | undefined;
        let b: Stop;
        let onward: Stop | undefined;
        if (leg !== undefined) {
          const l = state.trip[leg - 1];
          if (!l) return { refused: "UNKNOWN_LEG", reason: `Their globe has ${state.trip.length} leg(s).`, next: "Use a leg number from their globe, or pass to." };
          [a, b, onward] = [l.from, l.to, state.trip[leg]?.to];
        } else if (to) {
          const there = place(to);
          if ("refused" in there) return there;
          const here = from ? place(from) : undefined;
          if (here && "refused" in here) return here;
          [a, b] = [here, there];
        } else return { refused: "NO_LEG", reason: "No leg or place given.", next: "Pass leg or to." };
        const answer = legEntry(a, b, state.nationalities, onward);
        return { from: a?.name ?? null, to: b.name, ...answer };
      },
    }),

    find_meetup: tool({
      description:
        "Where should people coming from different places meet? Scores the big cities, searches real routes for the best few and ranks them. Shows a card. The first group is the person you're talking to.",
      inputSchema: z.object({
        groups: z.array(z.object({ from: z.string(), people: z.number().int().min(1).default(1) })).min(2).max(MAX_MEETUP_GROUPS),
        date: date.describe("The day they arrive"),
        minimize: z.enum(["price", "duration"]).default("price"),
        fairest: z.boolean().default(false),
      }),
      execute: async (input) => {
        const groups: MeetupGroup[] = [];
        for (const g of input.groups) {
          const p = place(g.from);
          if ("refused" in p) return p;
          groups.push({ members: [], people: g.people, stopId: null, place: { name: p.name, lat: p.lat, lng: p.lng, hub: p.hub, code: p.code ?? null } });
        }
        emit({ t: "activity", label: `comparing meet-ups for ${groups.length} groups`, at: { lat: groups[0].place.lat, lng: groups[0].place.lng } });
        const result = await findMeetup(
          { groups, date: input.date, minimize: input.minimize, fairest: input.fairest, candidates: [] },
          async (query) => {
            emit({ t: "activity", label: `checking ${query.to.name}`, at: { lat: query.to.lat, lng: query.to.lng } });
            return (await searchFromCoordinates(query, AbortSignal.any([signal, AbortSignal.timeout(12_000)]))).offers;
          }, undefined, signal,
        );
        emit({ t: "activity", label: null });
        if (!result.options.length) return { options: [], note: "No city had routes for every group. Suggest other dates." };
        for (const o of result.options) meetups.set(o.id, o);
        const title = `Where to meet · ${input.fairest ? "fairest" : input.minimize === "duration" ? "quickest" : "cheapest"}`;
        emit({ t: "card", card: { type: "meetup", title, options: result.options, applied: null, changesetId: null, undone: false, at: textAt() } });
        return { options: result.options.map(fmt), searched: result.searched, note: "The card shows these. Quote prices exactly; mention estimates." };
      },
    }),
  };
}

/** The day `n` days after an ISO date. */
function nextDay(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.max(1, n));
  return d.toISOString().slice(0, 10);
}

export type SoloInput = {
  messages: { role: "user" | "assistant"; text: string }[];
  trip: SoloLeg[];
  name: string;
  /** The passports they've saved, ISO-3. */
  nationalities: string[];
};

/**
 * Runs one reply, calling `emit` for each event as it happens. Never throws: a failure ends in a "failed" event.
 * `observe` sees every raw model stream part, for evals.
 */
export async function runSolo(
  { messages, trip, name, nationalities }: SoloInput, emit: Emit, signal: AbortSignal, observe?: (part: TextStreamPart<ToolSet>) => void,
) {
  const today = new Date().toISOString().slice(0, 10);
  let text = "";
  // the page holds the conversation, so its count of their messages numbers the turn
  const state: SoloState = { trip, nationalities, meetups: new Map(), turn: `solo:${messages.filter((m) => m.role === "user").length}` };
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
  const send = emit;
  emit = (event) => { if (!signal.aborted) send(event); };
  const tools = soloTools(emit, () => text.length, state, deadline);
  const asked = messages.at(-1)?.text ?? "";
  const write = (d: string) => {
    text += d;
    emit({ t: "text", d });
  };

  try {
    deadline.throwIfAborted();
    if (!process.env.DEEPSEEK_API_KEY) return finish(await fallback(asked, today, tools, state));
    let started = false;
    const did: SoloRecord = { planned: false, aborted: false, finish: undefined };
    try {
      const onGlobe = trip.length ? trip.map((l, i) => `${i + 1}. ${l.from.name} → ${l.to.name} on ${showDate(l.date)}`).join("; ") : "nothing yet";
      const passports = nationalities.length ? nationalities.map((c) => `${countryName(c)} (${c})`).join(", ") : "none saved";
      const result = streamText({
        model: deepseek(MODEL),
        system: `${SYSTEM}\n\nToday is ${today}. They're called ${name}. Their passports: ${passports}. On their globe: ${onGlobe}.`,
        messages: messages.map((m) => ({ role: m.role, content: m.text })),
        tools,
        stopWhen: isStepCount(MAX_STEPS),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        prepareStep: prepareEffort,
        abortSignal: deadline,
      });
      for await (const part of result.stream) {
        observe?.(part);
        if (part.type === "text-delta") {
          started = true;
          write(part.text);
        } else if (part.type === "start-step" && text && !text.endsWith("\n")) write("\n\n");
        else if (part.type === "tool-call") {
          started = true;
          const label = stepLabel(part.toolName);
          if (label) emit({ t: "step", id: part.toolCallId, label: label.doing, done: false, at: text.length, ...(GLOBE_TOOLS.has(part.toolName) ? { globe: true } : {}) });
        } else if (part.type === "tool-result" || part.type === "tool-error") {
          if (part.type === "tool-result" && part.toolName === "plan_trip" && !(part.output as { refused?: unknown }).refused) did.planned = true;
          const label = stepLabel(part.toolName, part.type === "tool-result" ? part.output : { refused: "ERROR" });
          if (label) emit({ t: "step", id: part.toolCallId, label: label.done, done: true, at: text.length, ...(GLOBE_TOOLS.has(part.toolName) ? { globe: true } : {}) });
        } else if (part.type === "error") throw part.error;
        else if (part.type === "abort") did.aborted = true;
        else if (part.type === "finish") did.finish = part.finishReason;
      }
    } catch (error) {
      if (started || deadline.aborted) throw error;
      console.error("PIP_SOLO_MODEL_UNAVAILABLE", error instanceof Error ? error.message : error);
      return finish(await fallback(asked, today, tools, state));
    }
    if (did.aborted && !signal.aborted) console.warn("PIP_SOLO_TIMEOUT");
    finish(soloEnding(text, did));
  } catch (error) {
    if (signal.aborted) return;
    console.error("PIP_SOLO_FAILED", error);
    if (!text.trim()) write("Something went wrong on my side. Try asking again.");
    emit({ t: "failed" });
  }

  function finish(last: string) {
    if (last) write(last);
    emit({ t: "done" });
  }
}

/** What a reply did, so one with no words, or cut off, still says what happened. */
export type SoloRecord = { planned: boolean; aborted: boolean; finish: string | undefined };

/** What to add after the model's words: nothing when it finished, a note when it was cut off, a whole reply when it wrote none. */
export function soloEnding(text: string, did: SoloRecord): string {
  const cut = did.aborted ? "I ran out of time there." : did.finish === "length" ? "I got cut off there; ask me to finish." : null;
  if (text.trim()) return cut ? `\n\n${cut}` : "";
  if (did.planned) return cut ? `It's on your globe. ${cut}` : "It's on your globe.";
  if (did.aborted) return "I ran out of time before answering. Try asking again.";
  if (did.finish === "length" || did.finish === "tool-calls") return "I didn't get to the end of that. Try asking one thing at a time.";
  return "Sorry, I lost track of that one. Can you ask again?";
}

/**
 * Without the model, Pip still puts a trip on the globe from the cities named in the message, or finds where two
 * of them should meet: the demo never hangs on a provider (AGENTS.md).
 */
async function fallback(asked: string, today: string, tools: ReturnType<typeof soloTools>, state: SoloState) {
  const call = { toolCallId: "fallback", messages: [] } as never;
  if (/\b(visas?|passports?|entry)\b/i.test(asked) && state.trip.length) {
    const lines: string[] = [];
    for (let leg = 1; leg <= state.trip.length; leg++) {
      const r = (await tools.check_entry.execute!({ leg }, call)) as { to?: string; summary?: string; crossesBorder?: boolean | null; status?: string };
      if (r.status === "passport_not_provided") return "You haven't saved a passport yet. Add yours under Passports in the profile menu and ask again.";
      if (r.crossesBorder) lines.push(`${r.to}: ${r.summary}`);
    }
    return lines.length
      ? `${lines.join("\n\n")}\n\n${OFFICIAL_ENTRY_REMINDER}`
      : "None of the legs on your globe cross a border I know about.";
  }
  const named = citiesIn(asked);
  if (named.length < 2) return "Tell me where you're starting from and where you're going, and I'll put it on your globe.";
  const day = dateIn(asked) ?? nextDay(today, 1);
  if (/\b(meet|middle|halfway)/i.test(asked)) {
    const r = (await tools.find_meetup.execute!({ groups: named.map((from) => ({ from, people: 1 })), date: day, minimize: "price", fairest: /\b(fair|middle|halfway)/i.test(asked) }, call)) as { options?: unknown[] };
    return r.options?.length ? `Here's where you could meet on ${showDate(day)}.` : "I couldn't find a city with routes for everyone that day. Try another date.";
  }
  const r = (await tools.plan_trip.execute!({ stops: named, dates: [day] }, call)) as { refused?: string };
  if (r.refused) return "I couldn't place one of those cities. Which one do you mean?";
  return `${named.join(" → ")} is on your globe for ${showDate(day)}; the card's searching fares.`;
}
