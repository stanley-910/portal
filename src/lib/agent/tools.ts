import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { editPlan, resolvePlace, type EditOp, type PlaceRef } from "@/lib/agent/edit";
import { findMeetup, type MeetupGroup } from "@/lib/agent/meetup";
import { computeSplit } from "@/lib/trip/split";
import { describePlan, type Handles, type PlanJson } from "@/lib/agent/snapshot";
import type { MeetupOption, ThreadCard } from "@/lib/agent/types";
import { searchFromCoordinates } from "@/lib/transport/hub-search";

// Thin wrappers: the work is in edit.ts and meetup.ts, which are tested on their own. Results are short and use
// handles; the cards people see are written to the thread separately (harness: "two views").

// Rough rates to put options in price order. Ordering only; prices are always quoted in their own currency.
const USD_RATE: Record<string, number> = { USD: 1, CNY: 0.138, HKD: 0.128, JPY: 0.0067, KRW: 0.00072, TWD: 0.031, THB: 0.028, MYR: 0.21, SGD: 0.74, EUR: 1.08 };

export type ToolContext = {
  roomId: string;
  agentId: string;
  today: string;
  askedBy: string;
  /** Re-reads Storage; tools call it so they never act on a stale plan. */
  load: () => Promise<{ plan: PlanJson; handles: Handles }>;
  addCard: (card: ThreadCard) => Promise<void>;
  /** What Pip is doing, beside its cursor, and where on the globe it's looking. */
  activity: (text: string, at?: { lat: number; lng: number }) => void;
  /** Marks a meet-up card's option as on the trip, with the changeset its Undo reverts. */
  markMeetup: (messageId: string, option: string, changesetId: string) => Promise<void>;
  /** Options from find_meetup this run, by handle, for apply_meetup. */
  meetups: Map<string, MeetupOption>;
  /** When the run's turn ends: past it the next reply may have started, so the trip mustn't change any more. */
  until: number;
};

const placeRef = z
  .union([
    z.object({ stop: z.string().describe("A stop handle from get_trip, e.g. S2") }),
    z.object({ place: z.string().describe("A city, airport or station name, e.g. Shanghai or HK West Kowloon") }),
  ])
  .describe("Where: an existing stop handle, or a place name");

const date = z.string().describe("YYYY-MM-DD");

const editOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_leg"),
    from: placeRef,
    to: placeRef,
    date,
    riders: z.array(z.string()).describe("Member handles who travel on it, e.g. [\"M1\",\"M2\"]"),
  }),
  z.object({ op: z.literal("set_date"), leg: z.string().describe("Leg handle"), date }),
  z.object({ op: z.literal("set_riders"), leg: z.string(), riders: z.array(z.string()) }),
  z.object({ op: z.literal("remove_leg"), leg: z.string() }),
  z.object({
    op: z.literal("set_stay_cost"),
    stop: z.string().describe("Stop handle"),
    nightly: z
      .object({ amount: z.number().min(0), currency: z.string().length(3).describe("ISO code, e.g. HKD") })
      .nullable()
      .describe("What staying there costs the whole group per night, as someone said it; null clears it. Never estimate one."),
    label: z.string().max(60).nullable().optional().describe("e.g. Shinjuku apartment"),
  }),
  z.object({
    op: z.literal("set_leaves"),
    member: z.string().describe("Member handle"),
    date: date.nullable().describe("The day they leave; their last night is the one before. Null: they stay to the end"),
  }),
  z.object({
    op: z.literal("set_trip_end"),
    date: date.nullable().describe("The morning after the trip's last night. Null: it ends after the last leg"),
  }),
]);

/** How fresh a price is, said the same way every time so the model can't guess. */
const KIND = { live: "live fare", cached: "cached fare", timetable: "timetable fare", estimated: "estimated" } as const;

/** Amounts per currency, never converted: "HKD 1,240 + USD 67". */
const money = (sums: Record<string, number>) =>
  Object.entries(sums).map(([c, n]) => `${c} ${n.toLocaleString("en-GB")}`).join(" + ");

const fmt = (o: MeetupOption) => {
  const legs = o.legs
    .map((l) => {
      const price = l.price ? `${l.price.currency} ${Math.round(l.price.amount)}` : "no price";
      return `${l.from.name}: ${l.mode}${l.carrier ? ` ${l.carrier}` : ""}, ${Math.round(l.durationMin / 6) / 10}h, ${price} each (${KIND[l.kind]})`;
    })
    .join("; ");
  const total = o.total ? `about USD ${o.total.amount} in all` : "total unknown";
  return `${o.id} ${o.place.name}${o.place.code ? ` (${o.place.code})` : ""}: ${legs}. ${total}.`;
};

/** What a tool that would change the trip says once the run is out of time. */
const OUT_OF_TIME = {
  refused: "OUT_OF_TIME",
  reason: "I ran out of time before making that change.",
  next: "Say nothing changed and ask them to send it again.",
} as const;

export function agentTools(ctx: ToolContext) {
  return {
    get_trip: tool({
      description: "The trip as it is now: members, stops and legs with handles. Read-only; call it before editing if the plan may have changed.",
      inputSchema: z.object({}),
      execute: async () => {
        const { plan, handles } = await ctx.load();
        return describePlan(plan, handles, ctx.today, ctx.askedBy);
      },
    }),

    get_leg_options: tool({
      description:
        "The options found for one leg, cheapest first, with times, how fresh each price is, votes and which one is chosen. Use it to answer questions about fares or times on a leg; never guess them.",
      inputSchema: z.object({ leg: z.string().describe("Leg handle from get_trip, e.g. L2") }),
      execute: async ({ leg }) => {
        const { plan, handles } = await ctx.load();
        const id = handles.id.get(leg);
        const l = id ? plan.legs?.[id] : undefined;
        if (!l) return { refused: "UNKNOWN_HANDLE", reason: `${leg} isn't in the trip.`, next: "Call get_trip and use its handles." };
        if (l.search.status === "searching") return { status: "searching", note: "Options are still loading. Say so, or check again shortly." };
        const usd = (o: (typeof l.search.offers)[number]) => (o.price ? o.price.amount * (USD_RATE[o.price.currency] ?? Infinity) : Infinity);
        const votes = new Map<string, number>();
        for (const offer of Object.values(l.votes ?? {})) votes.set(offer, (votes.get(offer) ?? 0) + 1);
        const options = [...l.search.offers].sort((a, b) => usd(a) - usd(b)).slice(0, 8).map((o, i) => {
          const price = o.price ? `${o.price.currency} ${Math.round(o.price.amount)}` : "no price";
          const time = o.kind === "estimated" ? "time unknown" : `${o.depart.slice(11, 16)}→${o.arrive.slice(11, 16)}`;
          const extras = [o.stops ? `${o.stops} change${o.stops > 1 ? "s" : ""}` : "direct", votes.get(o.id) ? `${votes.get(o.id)} vote(s)` : "", l.chosen === o.id ? "CHOSEN" : ""].filter(Boolean).join(", ");
          return `${i + 1}. ${o.mode}${o.carrier ? ` ${o.carrier}` : ""} ${time}, ${Math.floor(o.durationMin / 60)}h${String(o.durationMin % 60).padStart(2, "0")}, ${price} (${KIND[o.kind]}), ${extras}`;
        });
        return { leg, total: l.search.offers.length, options, note: "Quote these exactly. Prices in different currencies are ordered by a rough conversion." };
      },
    }),

    get_split: tool({
      description:
        "Who pays what: each member's fares by leg and their share of each night's stay, totalled per currency, with what's missing (no option chosen on a leg, no stay cost). Nights come from legs, leave dates and the trip end. Quote it; never add up costs yourself.",
      inputSchema: z.object({}),
      execute: async () => {
        const { plan, handles } = await ctx.load();
        const split = computeSplit(plan);
        const legName = (id: string) => handles.leg.get(id) ?? "?";
        const stopName = (id: string) => plan.stops?.[id]?.name ?? "?";
        const members = Object.entries(split.members).map(([id, m]) => {
          const who = `${handles.member.get(id) ?? "?"} ${plan.members?.[id]?.name ?? "someone"}`;
          const fares = m.fares.map((f) => `${legName(f.leg)} ${f.price ? `${f.price.currency} ${f.price.amount} (${KIND[f.kind ?? "estimated"]})` : "no option chosen"}`);
          // nights grouped by stop, each stop's shares added per currency
          const byStop = new Map<string, { nights: number; sums: Record<string, number> }>();
          for (const n of m.nightShares) {
            const e = byStop.get(n.stop) ?? { nights: 0, sums: {} };
            e.nights++;
            e.sums[n.share.currency] = Math.round(((e.sums[n.share.currency] ?? 0) + n.share.amount) * 100) / 100;
            byStop.set(n.stop, e);
          }
          const stays = [...byStop].map(([stop, e]) => `${stopName(stop)} ${e.nights} night${e.nights > 1 ? "s" : ""} ${money(e.sums)}`);
          const unpriced = split.nights.filter((n) => !n.nightly && n.present.includes(id)).length;
          return [
            who,
            `fares: ${fares.join("; ") || "none"}`,
            `stays: ${stays.join("; ") || "none priced"}${unpriced ? ` (+${unpriced} unpriced night${unpriced > 1 ? "s" : ""})` : ""}`,
            `total: ${money(m.totals) || "nothing yet"}`,
            m.missing.length ? `missing: ${m.missing.map((x) => (x === "no_chosen_offer" ? "a leg has no option chosen" : "a stop has no stay cost")).join(", ")}` : "",
          ].filter(Boolean).join(" · ");
        });
        return {
          ends: split.ends,
          members,
          note: "Totals are per currency and never converted. If something is missing, say what, and that the total covers only what's priced.",
        };
      },
    }),

    edit_plan: tool({
      description:
        "Changes the trip for everyone, live on their globes: add legs, move dates, set riders, remove legs, set what a stay costs a night, when someone leaves, and when the trip ends. All ops in one call become one change people can undo, so apply directly when asked; don't ask permission. New or re-dated legs search for options automatically. Refused ops come back with a reason and what to do next; the others still apply.",
      inputSchema: z.object({ ops: z.array(editOp).min(1) }),
      execute: async ({ ops }) => {
        if (Date.now() > ctx.until) return OUT_OF_TIME;
        ctx.activity("editing the trip");
        const { plan, handles } = await ctx.load();
        const result = await editPlan(ctx.roomId, plan, handles, ops as EditOp[], ctx.agentId, ctx.until);
        if (result.changesetId) {
          await ctx.addCard({ type: "changes", changesetId: result.changesetId, lines: result.applied, undone: false });
        }
        return { applied: result.applied, refused: result.refused };
      },
    }),

    find_meetup: tool({
      description:
        "Where should people coming from different places meet? Scores every large city offline, then searches real routes for the best few and ranks them. Use it for 'where should we meet' questions; never work out fares or distances yourself. Default is cheapest for the group in total; set fairest when they want it even, or 'somewhere in the middle'. Shows a card everyone can apply from.",
      inputSchema: z.object({
        groups: z
          .array(
            z.object({
              members: z.array(z.string()).describe("Member handles travelling together; empty for someone not in the trip yet"),
              people: z.number().int().min(1).optional().describe("Head count when it isn't just the members"),
              from: placeRef,
            }),
          )
          .min(2),
        date: date.describe("The day they arrive, YYYY-MM-DD"),
        minimize: z.enum(["price", "duration"]).default("price"),
        fairest: z.boolean().default(false).describe("Minimise the worst-off person instead of the group total"),
        candidates: z.array(z.string()).default([]).describe("Only consider these cities; empty for all"),
      }),
      execute: async (input) => {
        const { plan, handles } = await ctx.load();
        const groups: MeetupGroup[] = [];
        for (const g of input.groups) {
          const members = g.members.map((m) => handles.id.get(m)).filter((m): m is string => !!m);
          const ref = g.from as PlaceRef;
          let stopId: string | null = null;
          let point;
          if ("stop" in ref) {
            stopId = handles.id.get(ref.stop) ?? null;
            const stop = stopId ? plan.stops?.[stopId] : undefined;
            if (!stop) return { refused: "UNKNOWN_HANDLE", reason: `${ref.stop} isn't a stop.`, next: "Call get_trip and use its handles." };
            point = stop;
          } else if ("place" in ref) {
            const r = resolvePlace(ref.place);
            if ("refusal" in r) return { refused: r.refusal.code, reason: r.refusal.reason, next: r.refusal.next };
            point = r.stop;
          } else return { refused: "UNKNOWN_PLACE", reason: "No place given.", next: "Pass a stop or a place." };
          groups.push({
            members,
            people: Math.max(1, g.people ?? members.length),
            stopId,
            place: { name: point.name, lat: point.lat, lng: point.lng, hub: point.hub, code: point.code ?? null },
          });
        }

        ctx.activity(`comparing meet-ups for ${groups.length} groups`, groups[0].place);
        const result = await findMeetup(
          { groups, date: input.date, minimize: input.minimize, fairest: input.fairest, candidates: input.candidates },
          async (query) => {
            ctx.activity(`checking ${query.to.name}`, query.to);
            return (await searchFromCoordinates(query, AbortSignal.timeout(12_000))).offers;
          },
        );
        if (!result.options.length) {
          return { options: [], note: "No candidate city had routes for every group. Suggest other dates or name candidates." };
        }
        for (const o of result.options) ctx.meetups.set(o.id, o);
        const title = `Where to meet · ${input.fairest ? "fairest" : input.minimize === "duration" ? "quickest" : "cheapest"}`;
        await ctx.addCard({ type: "meetup", title, options: result.options, applied: null, changesetId: null, undone: false });
        ctx.activity(`suggesting ${result.options[0].place.name}`, result.options[0].place);
        return {
          options: result.options.map(fmt),
          searched: result.searched,
          prunedOffline: result.pruned,
          note: "The card shows these to everyone with an Apply button. Quote prices exactly as given; mention estimates.",
        };
      },
    }),

    apply_meetup: tool({
      description:
        "Adds a find_meetup option to the trip: one leg per group to the meeting city, with that group's members as riders. Only when someone asked you to go ahead, or picked an option.",
      inputSchema: z.object({ option: z.string().describe("P1, P2 or P3 from the latest meet-up card in the thread") }),
      execute: async ({ option }) => {
        if (Date.now() > ctx.until) return OUT_OF_TIME;
        const { plan, handles } = await ctx.load();
        // the latest meet-up card with this option, from this run or an earlier one: no need to search again
        const message = [...(plan.thread ?? [])].reverse().find((m) => m.cards.some((c) => c.type === "meetup" && c.options.some((o) => o.id === option)));
        const card = message?.cards.find((c): c is Extract<ThreadCard, { type: "meetup" }> => c.type === "meetup");
        const o = card?.options.find((x) => x.id === option) ?? ctx.meetups.get(option);
        if (!o) return { refused: "UNKNOWN_HANDLE", reason: `No meet-up card has ${option}.`, next: "Call find_meetup first." };
        if (card?.applied && !card.undone) return { refused: "ALREADY_APPLIED", reason: `${card.applied} from that card is already on the trip.`, next: "Tell them; Undo on the card takes it off." };
        const result = await editPlan(ctx.roomId, plan, handles, meetupOps(o, handles), ctx.agentId, ctx.until);
        if (result.changesetId && message) await ctx.markMeetup(message.id, option, result.changesetId);
        return { applied: result.applied, refused: result.refused, note: "The meet-up card now shows it on the trip, with Undo." };
      },
    }),
  };
}

/** The edits that put a meet-up option on the trip. Shared with the card's Apply button. */
export function meetupOps(o: MeetupOption, handles: Handles): EditOp[] {
  const to: PlaceRef = { at: { lat: o.place.lat, lng: o.place.lng, hub: o.place.hub, code: o.place.code, name: o.place.name } };
  return o.legs.map((leg) => ({
    op: "add_leg" as const,
    from: leg.fromStop && handles.stop.get(leg.fromStop)
      ? { stop: handles.stop.get(leg.fromStop)! }
      : { at: { lat: leg.from.lat, lng: leg.from.lng, hub: leg.from.hub, code: leg.from.code, name: leg.from.name } },
    to,
    date: o.date,
    riders: leg.members.map((m) => handles.member.get(m)).filter((m): m is string => !!m),
  }));
}
