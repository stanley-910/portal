import { NEARBY_RAIL_INSTRUCTION, railPreferences, searchNearbyRail } from "./nearby-rail";
import "server-only";

import { deepseek, type DeepSeekLanguageModelChatOptions } from "@ai-sdk/deepseek";
import { isStepCount, streamText, tool } from "ai";
import { z } from "zod";

import { dateIn } from "@/lib/agent/dates";
import { resolvePlace } from "@/lib/agent/edit";
import { legEntry, OFFICIAL_ENTRY_REMINDER } from "@/lib/agent/entry";
import { legMarks, midpoint, SAUCER_ENTER_MS, SAUCER_FLY_MS, SAUCER_STAY_MS, type AgentMark } from "@/lib/agent/marks";
import { findMeetup, type MeetupGroup } from "@/lib/agent/meetup";
import { citiesIn, MODEL, REASONING_EFFORT } from "@/lib/agent/run";
import { showDate } from "@/lib/agent/snapshot";
import { stepLabel } from "@/lib/agent/steps";
import { fmt, KIND } from "@/lib/agent/tools";
import { AGENT_NAME, type MeetupOption, type ThreadCard } from "@/lib/agent/types";
import { PERSONA, STYLE } from "@/lib/agent/voice";
import type { Stop } from "@/lib/liveblocks/types";
import { countryName } from "@/lib/nationality";
import { searchFromCoordinates } from "@/lib/transport/hub-search";
import { toStoredOffer } from "@/lib/trip/offers";
import { stopToPlace } from "@/lib/trip/stops";

// Pip on the home globe, before there's a trip: no room, no session. The browser sends the conversation and the
// legs on its globe; Pip answers in a stream of events the browser applies itself. Planned legs land on that
// globe, where the trip card searches fares, and Save trip keeps them in the person's account.

/** One event in the reply stream, sent as a line of JSON. `at` is how far the text had got. */
export type SoloEvent =
  | { t: "text"; d: string }
  | { t: "card"; card: ThreadCard }
  | { t: "step"; id: string; label: string; done: boolean; at: number }
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
 * The whole reply. Most finish in under 15 s at REASONING_EFFORT "high"; this leaves room for a slow multi-step one,
 * and the no-model fallback still fits inside the route's maxDuration (app/api/pip/route.ts) after it.
 */
export const TIMEOUT_MS = 80_000;

const SYSTEM = `You are ${AGENT_NAME}, the travel agent inside Portal, a globe where people plan how to get between places in Asia.
You're talking to one person on their own globe, before they've saved a trip. Their globe shows whatever legs are on it now.

${PERSONA}

What you do: work out how to get between places. Put legs on their globe, search routes and fares, find where people coming from different places should meet.
What you don't do: itineraries, sights, hotels, restaurants or reviews. Say so in one sentence if asked.
You can't book, pay or pick an option for them.

How to work:
- Whenever a message names where they're going and it isn't on their globe yet, call plan_trip first, straight away, with the stops in order and a date per leg: it puts the legs on their globe and each leg's card searches fares. Never ask whether to put it on the globe. If they give no date, use tomorrow and say so.
- A return or round trip is just one more leg back to where they started. Call plan_trip with the trip's stops (the ones on their globe, or the ones they name) and the first stop again at the end, the return date as that last leg's date. "How do I get back?" means the same: keep the legs they have and add the one home.
- Then, if they asked about fares, times or the cheapest way, call search_routes for it in the same turn.
- To talk about fares or times, call search_routes and quote it exactly; say when a price is estimated. Never estimate fares, distances or durations yourself.
- ${NEARBY_RAIL_INSTRUCTION}
- For visa, passport or entry questions, call check_entry for each leg it's about (by its number on their globe), or for a place they name. It covers every passport they've saved. Never answer one from memory. Name the passport each requirement applies to ("on your US passport you need a visa; on your Canadian one it's visa-free for 30 days"). When their passports differ, say plainly which needs a visa or document and which doesn't, and which to travel on. If they've saved no passport, say so: they add them under Passports in the profile menu. Mention estimated rules as estimates, and end with the official-source reminder.
- For "where should we meet", call find_meetup. Its card has a button that puts their own leg on the globe.
- Dates: resolve "the 14th" or "next Friday" against today's date to YYYY-MM-DD.
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

const usd: Record<string, number> = { USD: 1, CNY: 0.138, HKD: 0.128, JPY: 0.0067, KRW: 0.00072, TWD: 0.031, THB: 0.028, MYR: 0.21, SGD: 0.74, EUR: 1.08 };

type Emit = (event: SoloEvent) => void;

/** What one reply's tools share: the legs on the globe now (plan_trip replaces them) and the person's passports. */
type SoloState = { trip: SoloLeg[]; nationalities: string[]; meetups: Map<string, MeetupOption> };

function soloTools(emit: Emit, textAt: () => number, state: SoloState) {
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
        // one change at a time, each under the saucer: it flies to where a leg ends, the leg lands there, and it stays
        // a beat before the next. Legs that go come off first, then new ones go on in order.
        const key = (l: SoloLeg) => `${l.from.lat},${l.from.lng}>${l.to.lat},${l.to.lng}`;
        const keep = new Set(legs.map(key));
        const had = new Set(state.trip.map(key));
        const going = state.trip.filter((l) => !keep.has(key(l)));
        const coming = legs.filter((l) => !had.has(key(l)));
        const steps = [
          ...going.map((l, i) => ({ at: l.to, trip: state.trip.filter((x) => !going.slice(0, i + 1).includes(x)) })),
          ...coming.map((l, i) => ({ at: l.to, trip: legs.filter((x) => had.has(key(x)) || coming.slice(0, i + 1).includes(x)) })),
        ];
        for (const [i, step] of steps.entries()) {
          emit({ t: "activity", label: "planning the trip", at: { lat: step.at.lat, lng: step.at.lng } });
          // the first flies in from off the screen
          await new Promise((done) => setTimeout(done, i ? SAUCER_FLY_MS : SAUCER_ENTER_MS));
          emit({ t: "trip", legs: step.trip });
          emit({ t: "marks", marks: legMarks(state.trip, step.trip) });
          state.trip = step.trip;
          if (i < steps.length - 1) await new Promise((done) => setTimeout(done, SAUCER_STAY_MS));
        }
        // the legs it kept take their new dates
        if (JSON.stringify(state.trip) !== JSON.stringify(legs)) emit({ t: "trip", legs });
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
          AbortSignal.timeout(15_000),
        ).catch(() => null);
        emit({ t: "activity", label: null });
        if (!result) return { refused: "SEARCH_FAILED", reason: "The search didn't come back.", next: "Say so; the trip card searches too." };
        const all = result.offers.map(toStoredOffer);
        const price = (o: (typeof all)[number]) => (o.price ? o.price.amount * (usd[o.price.currency] ?? Infinity) : Infinity);
        const offers = all.sort((x, y) => price(x) - price(y)).slice(0, 6);
        return {
          found: result.offers.length,
          options: offers.map((o) => {
            const cost = o.price ? `${o.price.currency} ${Math.round(o.price.amount)}` : "no price";
            const time = o.kind === "estimated" ? "time unknown" : `${o.depart.slice(11, 16)}→${o.arrive.slice(11, 16)}`;
            return `${o.mode}${o.carrier ? ` ${o.carrier}` : ""} ${time}, ${Math.floor(o.durationMin / 60)}h${String(o.durationMin % 60).padStart(2, "0")}, ${cost} (${KIND[o.kind]})`;
          }),
        };
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
            modes: ["train"], passengers: 1, currency: preferences.currency }, preferences, AbortSignal.timeout(15_000));
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
        groups: z.array(z.object({ from: z.string(), people: z.number().int().min(1).default(1) })).min(2),
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
            return (await searchFromCoordinates(query, AbortSignal.timeout(12_000))).offers;
          },
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

/** Runs one reply, calling `emit` for each event as it happens. Never throws: a failure ends in a "failed" event. */
export async function runSolo({ messages, trip, name, nationalities }: SoloInput, emit: Emit, signal: AbortSignal) {
  const today = new Date().toISOString().slice(0, 10);
  let text = "";
  const state: SoloState = { trip, nationalities, meetups: new Map() };
  const tools = soloTools(emit, () => text.length, state);
  const asked = messages.at(-1)?.text ?? "";
  const write = (d: string) => {
    text += d;
    emit({ t: "text", d });
  };

  try {
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
        providerOptions: { deepseek: { reasoningEffort: REASONING_EFFORT } satisfies DeepSeekLanguageModelChatOptions },
        abortSignal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
      });
      for await (const part of result.stream) {
        if (part.type === "text-delta") {
          started = true;
          write(part.text);
        } else if (part.type === "start-step" && text && !text.endsWith("\n")) write("\n\n");
        else if (part.type === "tool-call") {
          started = true;
          const label = stepLabel(part.toolName);
          if (label) emit({ t: "step", id: part.toolCallId, label: label.doing, done: false, at: text.length });
        } else if (part.type === "tool-result" || part.type === "tool-error") {
          if (part.type === "tool-result" && part.toolName === "plan_trip" && !(part.output as { refused?: unknown }).refused) did.planned = true;
          const label = stepLabel(part.toolName, part.type === "tool-result" ? part.output : { refused: "ERROR" });
          if (label) emit({ t: "step", id: part.toolCallId, label: label.done, done: true, at: text.length });
        } else if (part.type === "error") throw part.error;
        else if (part.type === "abort") did.aborted = true;
        else if (part.type === "finish") did.finish = part.finishReason;
      }
    } catch (error) {
      if (started || signal.aborted) throw error;
      console.error("PIP_SOLO_MODEL_UNAVAILABLE", error instanceof Error ? error.message : error);
      return finish(await fallback(asked, today, tools, state));
    }
    if (did.aborted && !signal.aborted) console.warn("PIP_SOLO_TIMEOUT");
    finish(soloEnding(text, did));
  } catch (error) {
    if (!signal.aborted) console.error("PIP_SOLO_FAILED", error);
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
