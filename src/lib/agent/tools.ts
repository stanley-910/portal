import "server-only";

import { tool } from "ai";
import { railPreferences, searchNearbyRail } from "./nearby-rail";
import { stopToPlace } from "@/lib/trip/stops";
import { z } from "zod";

import { editPlan, editTarget, newChangeset, resolvePlace, type EditOp, type PlaceRef, type Refusal } from "@/lib/agent/edit";
import { findMeetup, MAX_MEETUP_GROUPS, type MeetupGroup } from "@/lib/agent/meetup";
import { computeSplit } from "@/lib/trip/split";
import { describePlan, type Handles, type PlanJson } from "@/lib/agent/snapshot";
import type { MeetupOption, ThreadCard } from "@/lib/agent/types";
import { searchFromCoordinates } from "@/lib/transport/hub-search";
import { cancelSettle, settleLeg } from "@/lib/booking/flow";
import { liveblocks } from "@/lib/liveblocks/server";
import type { LegBooking } from "@/lib/liveblocks/types";
import { isBookable } from "@/lib/trip/offers";
import { legEntry, OFFICIAL_ENTRY_REMINDER } from "@/lib/agent/entry";
import { KIND } from "@/lib/agent/kind";
import { describeRoutes, optimize } from "@/lib/agent/optimize";
import { type AgentMark } from "@/lib/agent/marks";

// Thin wrappers: the work is in edit.ts and meetup.ts, which are tested on their own. Results are short and use
// handles; the cards people see are written to the thread separately (harness: "two views").

// Rough rates to put options in price order. Ordering only; prices are always quoted in their own currency.
const USD_RATE: Record<string, number> = { USD: 1, CNY: 0.138, HKD: 0.128, JPY: 0.0067, KRW: 0.00072, TWD: 0.031, THB: 0.028, MYR: 0.21, SGD: 0.74, EUR: 1.08, CAD: 0.73 };

export type ToolContext = {
  roomId: string;
  agentId: string;
  today: string;
  askedBy: string;
  /** Reads Storage. Reads a moment apart may share one; a tool that changes the trip passes `fresh`. */
  load: (opts?: { fresh?: boolean }) => Promise<{ plan: PlanJson; handles: Handles }>;
  addCard: (card: ThreadCard) => Promise<void>;
  /** What Pip is doing, beside its cursor, and where on the globe it's looking. */
  activity: (text: string, at?: { lat: number; lng: number }) => void;
  /** What an edit changed, for everyone's globe to pop up where it happened. */
  marks: (marks: AgentMark[]) => void;
  /** Marks a meet-up card's option as on the trip, with the changeset its Undo reverts. */
  markMeetup: (messageId: string, option: string, changesetId: string) => Promise<void>;
  /** Options from find_meetup this run, by handle, for apply_meetup. */
  meetups: Map<string, MeetupOption>;
  /** When the run's turn ends: past it the next reply may have started, so the trip mustn't change any more. */
  until: number;
  /** The asker's display currency, for totals they didn't give a currency for. */
  currency: string;
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
  z.object({
    op: z.literal("set_date"),
    leg: z.string().describe("Leg handle"),
    date: date.describe("YYYY-MM-DD. Never before the leg that gets its riders there; later legs they take move along if it passes them"),
  }),
  z.object({ op: z.literal("set_riders"), leg: z.string(), riders: z.array(z.string()) }),
  z.object({ op: z.literal("remove_leg"), leg: z.string() }),
  z.object({
    op: z.literal("set_stay"),
    stay: z.string().optional().describe("A stay handle (H1) to change; leave it out to add a new stay"),
    stop: z.string().optional().describe("Stop handle the stay is at; needed for a new stay"),
    check_in: date.optional().describe("YYYY-MM-DD, the first night; needed for a new stay"),
    check_out: date.optional().describe("YYYY-MM-DD, the morning they leave; needed for a new stay"),
    guests: z.array(z.string()).optional().describe("Member handles sleeping there, e.g. [\"M1\",\"M2\"]; needed for a new stay. Riding a leg there doesn't make anyone a guest"),
    nightly: z
      .object({ amount: z.number().min(0), currency: z.string().length(3).describe("ISO code, e.g. HKD") })
      .nullable()
      .optional()
      .describe("What the stay costs per night for all its guests, as someone said it; null clears it. Never estimate one."),
    label: z.string().max(60).nullable().optional().describe("e.g. Shinjuku apartment"),
  }),
  z.object({ op: z.literal("remove_stay"), stay: z.string().describe("Stay handle") }),
  z.object({
    op: z.literal("set_leaves"),
    member: z.string().describe("Member handle"),
    date: date.nullable().describe("The day they leave early; they stop sharing stays from that night. Kept after their first leg. Null: they stay to the end"),
  }),
]);

export { KIND };

/** Amounts per currency, never converted: "HKD 1,240 + USD 67". */
const money = (sums: Record<string, number>) =>
  Object.entries(sums).map(([c, n]) => `${c} ${n.toLocaleString("en-GB")}`).join(" + ");

export const fmt = (o: MeetupOption) => {
  const legs = o.legs
    .map((l) => {
      const price = l.price ? `${l.price.currency} ${Math.round(l.price.amount)}` : "no price";
      return `${l.from.name}: ${l.mode}${l.carrier ? ` ${l.carrier}` : ""}, ${Math.round(l.durationMin / 6) / 10}h, ${price} each (${KIND[l.kind]})`;
    })
    .join("; ");
  const total = o.total ? `about USD ${o.total.amount} in all` : "total unknown";
  return `${o.id} ${o.place.name}${o.place.code ? ` (${o.place.code})` : ""}: ${legs}. ${total}.`;
};

/** "group USD 360, booked ref ABC123: M1 Ann USD 180 paid; M2 Bo USD 180 card held" for one leg's bill. */
function bookingLine(b: LegBooking, plan: PlanJson, h: Handles): string {
  const seats = Object.entries(b.seats).map(([id, s]) => {
    const state = s.paid ? (b.status === "booked" ? "paid" : b.mode === "separate" ? "ticketed" : "card held") : s.details ? (b.status === "paying" ? "details in, not paid" : "details in") : "waiting for details";
    return `${h.member.get(id) ?? "?"} ${plan.members?.[id]?.name ?? "someone"} ${s.share.currency} ${s.share.amount} ${state}`;
  });
  const head = `${b.mode === "group" ? "group booking" : "separate tickets"} ${b.total.currency} ${b.total.amount}, ${b.status === "booked" ? `booked${b.reference ? ` ref ${b.reference}` : ""}` : b.status}${b.deadline && b.status !== "booked" ? `, deadline ${b.deadline}` : ""}`;
  return `${head}: ${seats.join("; ")}`;
}

/** A leg's options as get_leg_options numbers them: cheapest first by a rough conversion, the top eight. */
function ranked<O extends { price?: { amount: number; currency: string } | null }>(offers: readonly O[]): O[] {
  const usd = (o: O) => (o.price ? o.price.amount * (USD_RATE[o.price.currency] ?? Infinity) : Infinity);
  return [...offers].sort((a, b) => usd(a) - usd(b)).slice(0, 8);
}

/** What a tool that would change the trip says once the run is out of time. */
const OUT_OF_TIME = {
  refused: "OUT_OF_TIME",
  reason: "I ran out of time before making that change.",
  next: "Say nothing changed and ask them to send it again.",
} as const;

export function agentTools(ctx: ToolContext) {
  const look = (text: string, at?: Parameters<ToolContext["activity"]>[1]) => ctx.activity(text, at);
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
        const votes = new Map<string, number>();
        for (const offer of Object.values(l.votes ?? {})) votes.set(offer, (votes.get(offer) ?? 0) + 1);
        const options = ranked(l.search.offers).map((o, i) => {
          const price = o.price ? `${o.price.currency} ${Math.round(o.price.amount)}` : "no price";
          const time = `${o.kind === "estimated" ? "time unknown" : `${o.depart.slice(11, 16)}→${o.arrive.slice(11, 16)}`}${o.departs ? ` ${o.departs}→${o.arrives}` : ""}`;
          const extras = [o.stops ? `${o.stops} change${o.stops > 1 ? "s" : ""}` : "direct", votes.get(o.id) ? `${votes.get(o.id)} vote(s)` : "", isBookable(o) ? "bookable" : "", o.refund ? (o.refund.fee ? `refundable for a ${o.refund.fee.currency} ${o.refund.fee.amount} fee` : "refundable free") : "", l.chosen === o.id ? "CHOSEN" : ""].filter(Boolean).join(", ");
          return `${i + 1}. ${o.mode}${o.carrier ? ` ${o.carrier}` : ""} ${time}, ${Math.floor(o.durationMin / 60)}h${String(o.durationMin % 60).padStart(2, "0")}, ${price} (${KIND[o.kind]}), ${extras}`;
        });
        return { leg, total: l.search.offers.length, options, note: "Quote these exactly. Prices in different currencies are ordered by a rough conversion." };
      },
    }),

    search_nearby_trains: tool({
      description: "Search fresh train options around both ends of a leg, including adjacent cities, when optimizing cost or no trains appear. Read-only; includes transfer distances and unknown fares.",
      inputSchema: z.object({ leg: z.string().describe("Leg handle from get_trip"), ...railPreferences }),
      execute: async ({ leg, ...preferences }) => {
        const { plan, handles } = await ctx.load();
        const id = handles.id.get(leg);
        const selected = id ? plan.legs?.[id] : undefined;
        const from = selected && plan.stops?.[selected.from], to = selected && plan.stops?.[selected.to];
        if (!selected || !from || !to) return { refused: "UNKNOWN_HANDLE", next: "Call get_trip and use a current leg handle." };
        if (Date.now() >= ctx.until) return OUT_OF_TIME;
        look("checking nearby train stations", from);
        try {
          return await searchNearbyRail({ from: stopToPlace(from), to: stopToPlace(to), date: selected.date,
            modes: ["train"], passengers: 1, currency: preferences.currency }, preferences,
            AbortSignal.timeout(Math.max(1, Math.min(15_000, ctx.until - Date.now()))));
        } catch { return { refused: "SEARCH_FAILED", next: "Say the nearby rail search failed; do not infer that no trains exist." }; }
      },
    }),

    check_entry: tool({
      description:
        "Entry rules on one leg for every member, for every passport each one holds: what each passport needs (visa-free, e-visa, visa, permit), for how long, conditions, a transit option, official sources and how fresh it is, with the easiest passport marked. Use it for any visa, entry or passport question; never answer one from memory.",
      inputSchema: z.object({ leg: z.string().describe("Leg handle from get_trip, e.g. L2") }),
      execute: async ({ leg }) => {
        const { plan, handles } = await ctx.load();
        const legId = handles.id.get(leg);
        const selected = legId ? plan.legs?.[legId] : undefined;
        if (!legId || !selected) return { refused: "UNKNOWN_HANDLE", reason: `${leg} isn't in the trip.`, next: "Call get_trip and use its handles." };
        const from = plan.stops?.[selected.from];
        const to = plan.stops?.[selected.to];
        if (!to) return { refused: "UNKNOWN_HANDLE", reason: `${leg} has no destination.`, next: "Call get_trip and use its handles." };

        const members = Object.entries(plan.members ?? {}).map(([id, member]) => {
          const who = `${handles.member.get(id) ?? "?"} ${member.name}`;
          const passports = member.nationalities ?? [];
          if (!passports.length) return { member: who, rides: selected.riders.includes(id), status: "passport_not_provided" as const };
          const onward = nextLeg(plan, id, legId);
          const answer = legEntry(from, to, passports, onward ? plan.stops?.[onward.to] : undefined);
          if (!answer.crossesBorder) return { member: who, rides: selected.riders.includes(id), ...answer };
          const { passports: rows, easiest, passportsDiffer, summary } = answer;
          return { member: who, rides: selected.riders.includes(id), easiest, passportsDiffer, summary, passports: rows };
        });
        return {
          leg,
          from: from?.name ?? "unknown",
          to: to.name,
          members,
          note: `Name the passport each requirement applies to. Where a member's passports differ, say which needs a visa or document and which doesn't. Say who has no passport recorded (they add one under Passports in the profile menu). Call only [estimated] rows estimates; the rest were checked against the official source linked. ${OFFICIAL_ENTRY_REMINDER}`,
        };
      },
    }),

    get_split: tool({
      description:
        "Who pays what: each member's fares by leg and their share of each night of the stays they're guests in, totalled per currency, with what's missing (no option chosen on a leg, no stay cost). Fares go to a leg's riders and nights to a stay's guests, separately. Quote it; never add up costs yourself.",
      inputSchema: z.object({}),
      execute: async () => {
        const { plan, handles } = await ctx.load();
        const split = computeSplit(plan);
        const legName = (id: string) => handles.leg.get(id) ?? "?";
        const stopName = (id: string) => plan.stops?.[id]?.name ?? "?";
        const members = Object.entries(split.members).map(([id, m]) => {
          const who = `${handles.member.get(id) ?? "?"} ${plan.members?.[id]?.name ?? "someone"}`;
          const fares = m.fares.map((f) => `${legName(f.leg)} ${f.price ? `${f.price.currency} ${f.price.amount} (${KIND[f.kind ?? "estimated"]})` : "no option chosen"}`);
          // nights grouped by stay, each stay's shares added per currency
          const byStay = new Map<string, { stop: string; nights: number; sums: Record<string, number> }>();
          for (const n of m.nightShares) {
            const e = byStay.get(n.stay) ?? { stop: n.stop, nights: 0, sums: {} };
            e.nights++;
            e.sums[n.share.currency] = Math.round(((e.sums[n.share.currency] ?? 0) + n.share.amount) * 100) / 100;
            byStay.set(n.stay, e);
          }
          const stays = [...byStay].map(([stay, e]) => `${handles.stay.get(stay) ?? "?"} ${stopName(e.stop)} ${e.nights} night${e.nights > 1 ? "s" : ""} ${money(e.sums)}`);
          const unpriced = split.nights.filter((n) => !n.nightly && n.present.includes(id)).length;
          return [
            who,
            `fares: ${fares.join("; ") || "none"}`,
            `stays: ${stays.join("; ") || "none priced"}${unpriced ? ` (+${unpriced} unpriced night${unpriced > 1 ? "s" : ""})` : ""}`,
            `total: ${money(m.totals) || "nothing yet"}`,
            m.missing.length ? `missing: ${m.missing.map((x) => (x === "no_chosen_offer" ? "a leg has no option chosen" : "a stay has no price")).join(", ")}` : "",
          ].filter(Boolean).join(" · ");
        });
        return {
          ends: split.ends,
          members,
          note: "Totals are per currency and never converted. If something is missing, say what, and that the total covers only what's priced.",
        };
      },
    }),

    book_leg: tool({
      description:
        "Books a leg for its riders in the app. Picks the option when one is named (its number from get_leg_options; only options marked bookable), settles the group on it at today's fare, and posts a checkout card where each rider confirms their own details and pays their own share without leaving the app. Call it as soon as a rider asks; the card shows the price. A leg already being booked just gets its card again. If the fare moved since it was found, it comes back PRICE_CHANGED: tell them the new price, and call again with accept_price once someone says go.",
      inputSchema: z.object({
        leg: z.string().describe("Leg handle from get_trip, e.g. L2"),
        option: z.number().int().min(1).max(8).optional().describe("Option number from get_leg_options, when they named one; omit to book the option already chosen"),
        accept_price: z.number().positive().optional().describe("The new per-seat price from PRICE_CHANGED, once they've agreed to it"),
      }),
      execute: async ({ leg, option, accept_price }) => {
        if (Date.now() > ctx.until) return OUT_OF_TIME;
        const { plan, handles } = await ctx.load({ fresh: true });
        const legId = handles.id.get(leg);
        const l = legId ? plan.legs?.[legId] : undefined;
        if (!legId || !l) return { refused: "UNKNOWN_HANDLE", reason: `${leg} isn't in the trip.`, next: "Call get_trip and use its handles." };
        if (l.booking) {
          await ctx.addCard({ type: "checkout", legId });
          return { status: "already_settled", booking: bookingLine(l.booking, plan, handles), note: "The checkout card is up again. Each rider confirms their own details and share there." };
        }
        const asker = { id: ctx.askedBy, name: plan.members?.[ctx.askedBy]?.name ?? null, email: null };
        if (!l.riders.includes(asker.id)) return { refused: "NOT_A_RIDER", reason: "Only someone riding this leg can book it.", next: "Say a rider needs to ask, or add them with set_riders first." };
        let chosen = l.search.offers.find((o) => o.id === l.chosen) ?? null;
        if (option !== undefined) {
          const pick = ranked(l.search.offers)[option - 1];
          if (!pick) return { refused: "UNKNOWN_OPTION", reason: `There's no option ${option}.`, next: "Call get_leg_options and use its numbers." };
          if (!isBookable(pick)) return { refused: "NOT_BOOKABLE", reason: "That option can't be bought in the app.", next: "Say it's booked on the provider's site, or offer a bookable option." };
          await liveblocks().mutateStorage(ctx.roomId, ({ root }) => {
            const live = root.get("legs").get(legId);
            if (live && !live.get("booking")) live.set("chosen", pick.id);
          });
          chosen = pick;
        }
        if (!chosen) return { refused: "NO_PICK", reason: "Nothing is chosen on this leg.", next: "Call get_leg_options and ask which bookable option they want, or book the one they named." };
        if (!isBookable(chosen)) return { refused: "NOT_BOOKABLE", reason: "The chosen option can't be bought in the app.", next: "Say it's booked on the provider's site, or offer a bookable option." };
        const accept = accept_price !== undefined ? { amount: accept_price, currency: chosen.price?.currency ?? "USD" } : undefined;
        const result = await settleLeg(ctx.roomId, legId, asker, accept);
        if (!result.ok) {
          if ("now" in result) return { status: "PRICE_CHANGED", was: result.was, now: result.now, note: "Per seat. Say the new price and ask whether to go ahead; then call book_leg again with accept_price." };
          return { refused: result.code, reason: result.message, next: result.code === "OFFER_GONE" ? "Say that fare is gone and offer the next bookable option from get_leg_options." : "Tell them plainly." };
        }
        await ctx.addCard({ type: "checkout", legId });
        const after = (await ctx.load({ fresh: true })).plan.legs?.[legId]?.booking;
        return {
          status: "settled",
          booking: after ? bookingLine(after, plan, handles) : result.mode,
          note: "The checkout card is up. Each rider confirms their own details (saved ones are one tap) and holds their share on their card there; nobody is charged until every seat is held, then the airline books it. You can't enter details or pay for anyone.",
        };
      },
    }),

    get_bill: tool({
      description: "Each member's bill on legs being booked or booked: their share, and whether their details are in, their card is held, or they've paid. Read-only. Use it for who still owes or what someone's paying.",
      inputSchema: z.object({}),
      execute: async () => {
        const { plan, handles } = await ctx.load();
        const legs = Object.entries(plan.legs ?? {}).filter(([, l]) => l.booking);
        if (!legs.length) return { bills: [], note: "Nothing is being booked yet." };
        return { bills: legs.map(([id, l]) => `${handles.leg.get(id) ?? "?"}: ${bookingLine(l.booking!, plan, handles)}`), note: "Shares are what each rider's card is held for; quote them exactly." };
      },
    }),

    cancel_booking: tool({
      description: "Undoes a settle on a leg while nobody has paid, releasing any held seats, when a rider asks. After someone has paid it can't.",
      inputSchema: z.object({ leg: z.string().describe("Leg handle from get_trip, e.g. L2") }),
      execute: async ({ leg }) => {
        if (Date.now() > ctx.until) return OUT_OF_TIME;
        const { plan, handles } = await ctx.load({ fresh: true });
        const legId = handles.id.get(leg);
        if (!legId || !plan.legs?.[legId]) return { refused: "UNKNOWN_HANDLE", reason: `${leg} isn't in the trip.`, next: "Call get_trip and use its handles." };
        const result = await cancelSettle(ctx.roomId, legId, { id: ctx.askedBy, name: plan.members?.[ctx.askedBy]?.name ?? null, email: null });
        return result.ok ? { status: "cancelled", note: "The leg is back in planning; nobody was charged." } : { refused: result.code, reason: result.message, next: "Tell them plainly." };
      },
    }),

    optimize_leg: tool({
      description:
        "Finds cheaper or better-timed ways to make one leg: the direct options, and routes that first get to a nearby station or airport (by metro and a border crossing, a short train, or an estimated ground transfer) and go on from there, overnight if need be, with connections chained and totals added up. Use it whenever a leg is too expensive, someone gives a budget, wants it cheaper, or wants to arrive with another member. Read-only; apply a route with apply_route.",
      inputSchema: z.object({
        leg: z.string().describe("Leg handle from get_trip, e.g. L1"),
        max_fare: z.number().positive().optional().describe("Per-person ceiling in `currency`, only if someone gave a number"),
        currency: z.string().regex(/^[A-Z]{3}$/).optional().describe("Currency to total in; defaults to the asker's display currency"),
        arrive_with: z.string().optional().describe("Another leg handle whose chosen option's arrival to line up with"),
        arrive_near: z.string().optional().describe("Or a time to arrive close to: 2026-10-20T19:30 local where they arrive, or with an offset"),
      }),
      execute: async (input) => {
        const { plan, handles } = await ctx.load();
        const id = handles.id.get(input.leg);
        const leg = id ? plan.legs?.[id] : undefined;
        const from = leg && plan.stops?.[leg.from], to = leg && plan.stops?.[leg.to];
        if (!leg || !from || !to) return { refused: "UNKNOWN_HANDLE", reason: `${input.leg} isn't in the trip.`, next: "Call get_trip and use its handles." };
        let arriveNear = input.arrive_near;
        let note = "";
        if (input.arrive_with) {
          const otherId = handles.id.get(input.arrive_with);
          const other = otherId ? plan.legs?.[otherId] : undefined;
          const chosen = other?.search.offers.find((o) => o.id === other.chosen);
          if (chosen && chosen.kind !== "estimated") arriveNear = chosen.arrive;
          else note = `${input.arrive_with} has no chosen option with a time yet, so arrivals weren't lined up; ask them to pick one or give a time. `;
        }
        if (Date.now() >= ctx.until) return OUT_OF_TIME;
        look("looking for a cheaper way", from);
        try {
          const composed = await optimize({
            from: stopToPlace(from), to: stopToPlace(to), date: leg.date,
            currency: input.currency ?? ctx.currency, maxFare: input.max_fare, arriveNear,
          }, AbortSignal.timeout(Math.max(1, Math.min(20_000, ctx.until - Date.now()))));
          const out = describeRoutes(composed);
          return { leg: input.leg, ...out, note: `${note}${out.note} To take a via route, call apply_route with this leg and its via station.` };
        } catch {
          return { refused: "SEARCH_FAILED", next: "Say the search failed; don't guess fares." };
        }
      },
    }),

    apply_route: tool({
      description:
        "Puts a via route from optimize_leg on the trip: splits the leg at the via station into two legs on the same day, for all its riders or just the ones named (the rest stay on the original leg). One change, undoable. Only when someone asked to go ahead or picked the route.",
      inputSchema: z.object({
        leg: z.string().describe("The leg handle optimize_leg ran on"),
        via: z.string().describe("The via station's name exactly as optimize_leg gave it, e.g. Shenzhen North"),
        riders: z.array(z.string()).optional().describe("Member handles taking the new route; leave out for everyone on the leg"),
      }),
      execute: async (input) => {
        if (Date.now() > ctx.until) return OUT_OF_TIME;
        const { plan, handles } = await ctx.load({ fresh: true });
        const id = handles.id.get(input.leg);
        const leg = id ? plan.legs?.[id] : undefined;
        if (!leg) return { refused: "UNKNOWN_HANDLE", reason: `${input.leg} isn't in the trip.`, next: "Call get_trip and use its handles." };
        // Check everything first: a refused add after the old leg went would lose the leg.
        if (leg.booking) return { refused: "LOCKED", reason: `${input.leg} is being booked, so it can't change.`, next: "Ask a rider to cancel the settle first." };
        const via = resolvePlace(input.via);
        if ("refusal" in via) return { refused: via.refusal.code, reason: via.refusal.reason, next: via.refusal.next };
        const ops = routeOps({ leg: input.leg, riders: leg.riders.map((r) => handles.member.get(r)!).filter(Boolean), date: leg.date,
          from: handles.stop.get(leg.from)!, to: handles.stop.get(leg.to)!, createdAt: leg.createdAt }, { at: via.stop }, input.riders);
        if ("refused" in ops) return ops;
        look("rerouting", plan.stops?.[leg.from]);
        // all or nothing, so the trip never ends up with the old leg and the new ones, or with neither
        const result = await editPlan(ctx.roomId, plan, handles, ops, ctx.agentId, ctx.until, undefined, true);
        ctx.marks(result.marks);
        if (result.applied.length && result.changesetId) {
          await ctx.addCard({ type: "changes", changesetId: result.changesetId, lines: result.applied, undone: false });
        }
        return { applied: result.applied, refused: result.refused, note: "The new legs search for their own options; say which ones match the route." };
      },
    }),

    edit_plan: tool({
      description:
        "Changes the trip for everyone, live on their globes: add legs, move dates, set riders, remove legs, add, change or remove stays (each with its own guests, nights and price, apart from the legs), and when someone leaves. All ops in one call become one change people can undo, so apply directly when asked; don't ask permission. New or re-dated legs search for options automatically. Refused ops come back with a reason and what to do next; the others still apply.",
      inputSchema: z.object({ ops: z.array(editOp).min(1) }),
      execute: async ({ ops }) => {
        if (Date.now() > ctx.until) return OUT_OF_TIME;
        const { plan, handles } = await ctx.load({ fresh: true });
        // Ordered changes share one Undo; clients animate the marks without delaying server work.
        const changeset = newChangeset();
        const applied: string[] = [];
        const refused: Refusal[] = [];
        for (const [i, op] of (ops as EditOp[]).entries()) {
          const target = editTarget(plan, handles, [op]);
          look("editing the trip", target ?? undefined);
          const step = await editPlan(ctx.roomId, plan, handles, [op], ctx.agentId, ctx.until, changeset);
          applied.push(...step.applied);
          refused.push(...step.refused.map((r) => ({ ...r, op: i })));
          ctx.marks(step.marks);
        }
        if (applied.length) await ctx.addCard({ type: "changes", changesetId: changeset.id, lines: applied, undone: false });
        // Finish searches before Pip quotes what it changed.
        await Promise.all(changeset.searches);
        return { applied, refused };
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
          .min(2).max(MAX_MEETUP_GROUPS),
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

        look(`comparing meet-ups for ${groups.length} groups`, groups[0].place);
        const result = await findMeetup(
          { groups, date: input.date, minimize: input.minimize, fairest: input.fairest, candidates: input.candidates },
          async (query) => {
            look(`checking ${query.to.name}`, query.to);
            return (await searchFromCoordinates(query, AbortSignal.timeout(Math.max(1, Math.min(12_000, ctx.until - Date.now()))))).offers;
          }, undefined, AbortSignal.timeout(Math.max(1, ctx.until - Date.now())),
        );
        if (!result.options.length) {
          return { options: [], note: "No candidate city had routes for every group. Suggest other dates or name candidates." };
        }
        for (const o of result.options) ctx.meetups.set(o.id, o);
        const title = `Where to meet · ${input.fairest ? "fairest" : input.minimize === "duration" ? "quickest" : "cheapest"}`;
        await ctx.addCard({ type: "meetup", title, options: result.options, applied: null, changesetId: null, undone: false });
        look(`suggesting ${result.options[0].place.name}`, result.options[0].place);
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
        const { plan, handles } = await ctx.load({ fresh: true });
        // the latest meet-up card with this option, from this run or an earlier one: no need to search again
        const message = [...(plan.thread ?? [])].reverse().find((m) => m.cards.some((c) => c.type === "meetup" && c.options.some((o) => o.id === option)));
        const card = message?.cards.find((c): c is Extract<ThreadCard, { type: "meetup" }> => c.type === "meetup");
        const o = card?.options.find((x) => x.id === option) ?? ctx.meetups.get(option);
        if (!o) return { refused: "UNKNOWN_HANDLE", reason: `No meet-up card has ${option}.`, next: "Call find_meetup first." };
        if (card?.applied && !card.undone) return { refused: "ALREADY_APPLIED", reason: `${card.applied} from that card is already on the trip.`, next: "Tell them; Undo on the card takes it off." };
        const result = await editPlan(ctx.roomId, plan, handles, meetupOps(o, handles), ctx.agentId, ctx.until);
        ctx.marks(result.marks);
        if (result.changesetId && message) await ctx.markMeetup(message.id, option, result.changesetId);
        return { applied: result.applied, refused: result.refused, note: "The meet-up card now shows it on the trip, with Undo." };
      },
    }),
  };
}

/** The leg a member rides after this one, by date, which decides whether a transit exemption applies here. */
export function nextLeg(plan: PlanJson, memberId: string, legId: string) {
  const mine = Object.entries(plan.legs ?? {})
    .filter(([, l]) => l.riders.includes(memberId))
    .sort(([, a], [, b]) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const at = mine.findIndex(([id]) => id === legId);
  return at < 0 ? undefined : mine[at + 1]?.[1];
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

/**
 * The edits that split a leg at `via`: the riders taking the route get two new legs; anyone else keeps the old one.
 * The new legs take the old one's place among the day's legs, so whatever comes after it still does.
 */
export function routeOps(
  { leg, riders: onLeg, date, from, to, createdAt }: { leg: string; riders: string[]; date: string; from: string; to: string; createdAt: number },
  via: PlaceRef,
  riders?: string[],
): EditOp[] | { refused: string; reason: string; next: string } {
  const moving = riders?.length ? riders : onLeg;
  const strangers = moving.filter((m) => !onLeg.includes(m));
  if (strangers.length) return { refused: "NOT_ON_LEG", reason: `${strangers.join(", ")} isn't on ${leg}.`, next: "Use the leg's own riders." };
  const staying = onLeg.filter((m) => !moving.includes(m));
  // the new legs go first: should a write only half land, the trip has a leg too many, not one too few
  return [
    { op: "add_leg", from: { stop: from }, to: via, date, riders: moving, createdAt: createdAt + 0.1 },
    { op: "add_leg", from: via, to: { stop: to }, date, riders: moving, createdAt: createdAt + 0.2 },
    staying.length ? { op: "set_riders", leg, riders: staying } : { op: "remove_leg", leg },
  ];
}
