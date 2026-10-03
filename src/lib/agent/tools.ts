import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { editPlan, resolvePlace, type EditOp, type PlaceRef } from "@/lib/agent/edit";
import { findMeetup, type MeetupGroup } from "@/lib/agent/meetup";
import { describePlan, type Handles, type PlanJson } from "@/lib/agent/snapshot";
import type { MeetupOption, ThreadCard } from "@/lib/agent/types";
import { searchFromCoordinates } from "@/lib/transport/hub-search";

// Thin wrappers: the work is in edit.ts and meetup.ts, which are tested on their own. Results are short and use
// handles; the cards people see are written to the thread separately (harness: "two views").

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
  /** Options from find_meetup this run, by handle, for apply_meetup. */
  meetups: Map<string, MeetupOption>;
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
]);

const fmt = (o: MeetupOption) => {
  const legs = o.legs
    .map((l) => {
      const price = l.price ? `${l.price.currency} ${Math.round(l.price.amount)}` : "no price";
      return `${l.from.name}: ${l.mode}${l.carrier ? ` ${l.carrier}` : ""}, ${Math.round(l.durationMin / 6) / 10}h, ${price} each${l.kind === "estimated" ? " (estimated)" : ""}`;
    })
    .join("; ");
  const total = o.total ? `about USD ${o.total.amount} in all` : "total unknown";
  return `${o.id} ${o.place.name}${o.place.code ? ` (${o.place.code})` : ""}: ${legs}. ${total}.`;
};

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

    edit_plan: tool({
      description:
        "Changes the trip for everyone, live on their globes: add legs, move dates, set riders, remove legs. All ops in one call become one change people can undo, so apply directly when asked; don't ask permission. New or re-dated legs search for options automatically. Refused ops come back with a reason and what to do next; the others still apply.",
      inputSchema: z.object({ ops: z.array(editOp).min(1) }),
      execute: async ({ ops }) => {
        ctx.activity("editing the trip");
        const { plan, handles } = await ctx.load();
        const result = await editPlan(ctx.roomId, plan, handles, ops as EditOp[], ctx.agentId);
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
      inputSchema: z.object({ option: z.string().describe("P1, P2 or P3 from find_meetup in this run") }),
      execute: async ({ option }) => {
        const o = ctx.meetups.get(option);
        if (!o) return { refused: "UNKNOWN_HANDLE", reason: `${option} isn't from this run.`, next: "Call find_meetup first." };
        const { plan, handles } = await ctx.load();
        const result = await editPlan(ctx.roomId, plan, handles, meetupOps(o, handles), ctx.agentId);
        if (result.changesetId) {
          await ctx.addCard({ type: "changes", changesetId: result.changesetId, lines: result.applied, undone: false });
        }
        return { applied: result.applied, refused: result.refused };
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
