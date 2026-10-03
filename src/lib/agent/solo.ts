import "server-only";

import { deepseek, type DeepSeekLanguageModelChatOptions } from "@ai-sdk/deepseek";
import { isStepCount, streamText, tool } from "ai";
import { z } from "zod";

import { dateIn } from "@/lib/agent/dates";
import { resolvePlace } from "@/lib/agent/edit";
import { findMeetup, type MeetupGroup } from "@/lib/agent/meetup";
import { citiesIn, MODEL } from "@/lib/agent/run";
import { showDate } from "@/lib/agent/snapshot";
import { stepLabel } from "@/lib/agent/steps";
import { fmt, KIND } from "@/lib/agent/tools";
import { AGENT_NAME, type MeetupOption, type ThreadCard } from "@/lib/agent/types";
import { PERSONA, STYLE } from "@/lib/agent/voice";
import type { Stop } from "@/lib/liveblocks/types";
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
  | { t: "activity"; label: string | null }
  | { t: "trip"; legs: SoloLeg[] }
  | { t: "done" }
  | { t: "failed" };

export type SoloLeg = { from: Stop; to: Stop; date: string };

const MAX_STEPS = 6;
const MAX_OUTPUT_TOKENS = 3_000;
const TIMEOUT_MS = 60_000;

const SYSTEM = `You are ${AGENT_NAME}, the travel agent inside Portal, a globe where people plan how to get between places in Asia.
You're talking to one person on their own globe, before they've saved a trip. Their globe shows whatever legs are on it now.

${PERSONA}

What you do: work out how to get between places. Put legs on their globe, search routes and fares, find where people coming from different places should meet.
What you don't do: itineraries, sights, hotels, restaurants or reviews. Say so in one sentence if asked.
You can't book, pay or pick an option for them.

How to work:
- Whenever a message names where they're going and it isn't on their globe yet, call plan_trip first, straight away, with the stops in order and a date per leg: it puts the legs on their globe and each leg's card searches fares. Never ask whether to put it on the globe. If they give no date, use tomorrow and say so.
- Then, if they asked about fares, times or the cheapest way, call search_routes for it in the same turn.
- To talk about fares or times, call search_routes and quote it exactly; say when a price is estimated. Never estimate fares, distances or durations yourself.
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

function soloTools(emit: Emit, textAt: () => number, meetups: Map<string, MeetupOption>) {
  return {
    plan_trip: tool({
      description:
        "Puts a trip on their globe: the stops in order, one leg between each pair, each on its date. Replaces what's there. Each leg's card then searches fares for them to pick from.",
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
        emit({ t: "trip", legs });
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
        emit({ t: "activity", label: `checking ${a.name} to ${b.name}` });
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
        emit({ t: "activity", label: `comparing meet-ups for ${groups.length} groups` });
        const result = await findMeetup(
          { groups, date: input.date, minimize: input.minimize, fairest: input.fairest, candidates: [] },
          async (query) => {
            emit({ t: "activity", label: `checking ${query.to.name}` });
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
};

/** Runs one reply, calling `emit` for each event as it happens. Never throws: a failure ends in a "failed" event. */
export async function runSolo({ messages, trip, name }: SoloInput, emit: Emit, signal: AbortSignal) {
  const today = new Date().toISOString().slice(0, 10);
  let text = "";
  const meetups = new Map<string, MeetupOption>();
  const tools = soloTools(emit, () => text.length, meetups);
  const asked = messages.at(-1)?.text ?? "";
  const write = (d: string) => {
    text += d;
    emit({ t: "text", d });
  };

  try {
    if (!process.env.DEEPSEEK_API_KEY) return finish(await fallback(asked, today, tools));
    let started = false;
    try {
      const onGlobe = trip.length ? trip.map((l) => `${l.from.name} → ${l.to.name} on ${showDate(l.date)}`).join("; ") : "nothing yet";
      const result = streamText({
        model: deepseek(MODEL),
        system: `${SYSTEM}\n\nToday is ${today}. They're called ${name}. On their globe: ${onGlobe}.`,
        messages: messages.map((m) => ({ role: m.role, content: m.text })),
        tools,
        stopWhen: isStepCount(MAX_STEPS),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        providerOptions: { deepseek: { reasoningEffort: "low" } satisfies DeepSeekLanguageModelChatOptions },
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
          const label = stepLabel(part.toolName, part.type === "tool-result" ? part.output : { refused: "ERROR" });
          if (label) emit({ t: "step", id: part.toolCallId, label: label.done, done: true, at: text.length });
        } else if (part.type === "error") throw part.error;
      }
    } catch (error) {
      if (started || signal.aborted) throw error;
      console.error("PIP_SOLO_MODEL_UNAVAILABLE", error instanceof Error ? error.message : error);
      return finish(await fallback(asked, today, tools));
    }
    finish(text.trim() ? "" : "Done.");
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

/**
 * Without the model, Pip still puts a trip on the globe from the cities named in the message, or finds where two
 * of them should meet: the demo never hangs on a provider (AGENTS.md).
 */
async function fallback(asked: string, today: string, tools: ReturnType<typeof soloTools>) {
  const named = citiesIn(asked);
  if (named.length < 2) return "Tell me where you're starting from and where you're going, and I'll put it on your globe.";
  const day = dateIn(asked) ?? nextDay(today, 1);
  const call = { toolCallId: "fallback", messages: [] } as never;
  if (/\b(meet|middle|halfway)/i.test(asked)) {
    const r = (await tools.find_meetup.execute!({ groups: named.map((from) => ({ from, people: 1 })), date: day, minimize: "price", fairest: /\b(fair|middle|halfway)/i.test(asked) }, call)) as { options?: unknown[] };
    return r.options?.length ? `Here's where you could meet on ${showDate(day)}.` : "I couldn't find a city with routes for everyone that day. Try another date.";
  }
  const r = (await tools.plan_trip.execute!({ stops: named, dates: [day] }, call)) as { refused?: string };
  if (r.refused) return "I couldn't place one of those cities. Which one do you mean?";
  return `${named.join(" → ")} is on your globe for ${showDate(day)}; the card's searching fares.`;
}
