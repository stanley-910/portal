import "server-only";

import { LiveMap, LiveObject, toPlainLson } from "@liveblocks/client";
import type { PlainLsonObject, RoomData } from "@liveblocks/node";
import { z } from "zod";

import { liveblocks } from "@/lib/liveblocks/server";
import { tripRoomId, type Leg, type MemberInfo, type Stay, type Stop, type TripStorage } from "@/lib/liveblocks/types";
import type { Offer, ProviderId } from "@/lib/transport/types";

import { tripOwner } from "./leave";
import { MAX_OFFERS, toStoredOffer, webUrlOrNull } from "./offers";
import { sameStop } from "./stops";
import { computeSplit, type SplitInput } from "./split";

export type TripCostBreakdown = {
  fares: { label: string; price: { amount: number; currency: string } | null; kind: string | null }[];
  nights: { stop: string; date: string; share: { amount: number; currency: string } }[];
};
export type TripSummary = {
  id: string;
  title: string;
  members: number;
  updatedAt: string;
  /** Whether the user the list is for owns the trip. Set only when the list is for someone. */
  owner?: boolean;
  costs?: Record<string, number>; breakdown?: TripCostBreakdown;
};

/** The saved plan of a trip room as plain JSON. Unreadable Storage reads as an empty plan. */
export async function readPlan(tripId: string): Promise<unknown> {
  try {
    return await liveblocks().getStorageDocument(tripRoomId(tripId), "json");
  } catch {
    return {};
  }
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []);
const asString = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Room list rows, newest activity first, for `userId` if given. `members` metadata may be a string or an array. */
export function toTripSummaries(rooms: Pick<RoomData, "id" | "metadata" | "createdAt" | "lastConnectionAt">[], userId?: string): TripSummary[] {
  return rooms
    .map((room) => ({
      id: room.id.replace(/^trip:/, ""),
      title: asString(room.metadata.title) ?? "New trip",
      members: asList(room.metadata.members).length,
      updatedAt: asString(room.metadata.updatedAt) ?? (room.lastConnectionAt ?? room.createdAt).toISOString(),
      ...(userId ? { owner: tripOwner(room.metadata) === userId } : {}),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The trips this user belongs to. Liveblocks being down gives an empty list, never an error. */
export async function listMyTrips(userId: string): Promise<TripSummary[]> {
  try {
    const { data } = await liveblocks().getRooms({ userId });
    const summaries = toTripSummaries(data.filter((room) => room.id.startsWith("trip:")), userId);
    return await Promise.all(
      summaries.map(async (summary) => {
        try {
          const plan = (await readPlan(summary.id)) as SplitInput & { stops?: Record<string, { name: string }> };
          const split = computeSplit(plan);
          const mine = split.members[userId];
          const legs = plan.legs ?? {};
          return {
            ...summary,
            costs: mine?.totals,
            breakdown: mine
              ? {
                  fares: mine.fares.map((fare) => {
                    const leg = legs[fare.leg];
                    const from = leg ? plan.stops?.[leg.from]?.name ?? leg.from : fare.leg;
                    const to = leg ? plan.stops?.[leg.to]?.name ?? leg.to : "";
                    return { label: `${from}${to ? ` → ${to}` : ""}`, price: fare.price, kind: fare.kind };
                  }),
                  nights: mine.nightShares.map((night) => ({
                    ...night,
                    stop: plan.stops?.[night.stop]?.name ?? night.stop,
                  })),
                }
              : undefined,
          };
        } catch {
          return summary;
        }
      }),
    );
  } catch {
    return [];
  }
}

// ---- Solo save from `/` ----

const PROVIDERS = ["travelpayouts", "12go", "tdx", "korea-tago", "china-rail", "busonlineticket", "gtfs", "srt", "duffel"] as const satisfies readonly ProviderId[];
const MODES = ["flight", "train", "bus", "ferry"] as const;
const MAX_SEGMENTS = 8;
/** All options together, after unknown fields are stripped. Twenty real offers are a few KB. */
const MAX_OFFERS_CHARS = 120_000;

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const text = (max: number) => z.string().trim().min(1).max(max);
const timestamp = z.string().max(40).refine((v) => Number.isFinite(Date.parse(v)), "bad time");

const stopSchema = z.object({
  lat,
  lng,
  hub: z.string().max(64).nullable(),
  code: z.string().max(16).nullable().default(null),
  name: text(120),
});

const placeSchema = z.object({ name: z.string().max(200), lat, lng });

const offerSchema = z.object({
  id: text(200),
  provider: z.enum(PROVIDERS),
  mode: z.enum(MODES),
  segments: z
    .array(
      z.object({
        mode: z.enum(MODES),
        carrier: z.string().max(120).optional(),
        number: z.string().max(40).optional(),
        from: placeSchema,
        to: placeSchema,
        depart: timestamp,
        arrive: timestamp,
        durationMin: z.number().min(0).max(100_000),
      }),
    )
    .min(1)
    .max(MAX_SEGMENTS),
  transfers: z.number().int().min(0).max(20).optional(),
  price: z
    .object({ amount: z.number().min(0).max(10_000_000), currency: z.string().regex(/^[A-Z]{3}$/), asOf: z.string().max(40).optional() })
    .optional(),
  kind: z.enum(["live", "cached", "timetable", "estimated"]),
  // rooms render it as a link, so a forged `javascript:` link is refused outright
  bookingUrl: z.string().max(2000).refine((v) => webUrlOrNull(v) !== null, "bad booking link").optional(),
  attribution: z.string().max(500).optional(),
});

/** YYYY-MM-DD, UTC. */
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

/**
 * What `/` sends to save a landed leg: its two stops (as `stopFromPoint` builds them), the depart date, the options
 * the popover showed and the one picked. Never trusted: unknown fields are stripped, sizes capped, and the date must
 * be from yesterday in UTC (a traveller west of UTC may still be on it) to a year ahead.
 */
/** One leg landed on `/`, with the options its search showed and the one picked. */
export const soloLegSchema = z
  .object({
    from: stopSchema,
    to: stopSchema,
    date: z.iso.date().refine((d) => d >= isoDay(Date.now() - DAY) && d <= isoDay(Date.now() + 400 * DAY), "date out of range"),
    offers: z.array(offerSchema).min(0).max(MAX_OFFERS),
    chosen: text(200).nullable(),
    // the hotel picked in the popover's Hotels tab: the whole group's cost per night, live or estimated
    stay: z
      .object({
        label: text(120),
        nightly: z.object({ amount: z.number().min(0).max(1_000_000), currency: z.string().regex(/^[A-Z]{3}$/) }),
        // a live hotel rate; anything unmarked is an estimate
        estimated: z.boolean().default(true),
      })
      .optional(),
  })
  .refine((v) => !sameStop(v.from, v.to), "from and to are the same place")
  .refine((v) => v.offers.length > 0 || v.stay !== undefined, "a flight or hotel must be selected")
  .refine((v) => v.chosen === null || v.offers.some((o) => o.id === v.chosen), "chosen offer is not among the options")
  .refine((v) => new Set(v.offers.map((o) => o.id)).size === v.offers.length, "duplicate offers")
  .refine((v) => JSON.stringify(v.offers).length <= MAX_OFFERS_CHARS, "options too large");

/** The most legs one save takes: far more stops than anyone clicks in one go. */
export const MAX_SOLO_LEGS = 8;

/** A trip landed on `/`: its legs in order, each departing no earlier than the one before. */
export const soloSaveSchema = z
  .object({ legs: z.array(soloLegSchema).min(1).max(MAX_SOLO_LEGS) })
  .refine((v) => v.legs.every((l, i) => i === 0 || l.date >= v.legs[i - 1].date), "legs out of order");

export type SoloSaveInput = z.infer<typeof soloSaveSchema>;

/** Storage as `getStorageDocument(room, "json")` returns it, for the parts a solo save writes. */
export type SoloStorageJson = {
  members: Record<string, MemberInfo>;
  stops: Record<string, Stop>;
  legs: Record<string, Omit<Leg, "votes"> & { votes: Record<string, string> }>;
  stays?: Record<string, Stay>;
};

/**
 * A trip whose legs' searches are already done (the options `/` showed), each with its picked offer chosen, drawn
 * and ridden by the saver, who is member colour 1. Legs that meet at the same place share its stop.
 */
export function buildSoloStorage(
  input: SoloSaveInput,
  user: { id: string; displayName: string },
  newId: () => string,
  now: number,
): SoloStorageJson {
  const stops: SoloStorageJson["stops"] = {};
  const legs: SoloStorageJson["legs"] = {};
  const stays: Record<string, Stay> = {};
  const stopAt = (stop: Stop) => {
    const found = Object.entries(stops).find(([, s]) => sameStop(s, stop));
    if (found) return found[0];
    const id = newId();
    stops[id] = stop;
    return id;
  };
  input.legs.forEach((leg, i) => {
    const from = stopAt(leg.from);
    const to = stopAt(leg.to);
    legs[newId()] = {
      from,
      to,
      date: leg.date,
      createdBy: user.id,
      riders: [user.id],
      // the schema checked each offer's fields; `provider` is a ProviderId there too
      search: { id: newId(), status: "done", offers: leg.offers.map((o) => toStoredOffer(o as Offer)) },
      votes: {},
      chosen: leg.chosen,
      // in order, so legs on the same day keep the order they were flown in
      createdAt: now + i,
    };
    if (leg.stay) stays[to] = leg.stay;
  });
  return {
    members: { [user.id]: { name: user.displayName, color: 1 } },
    stops,
    legs,
    ...(Object.keys(stays).length ? { stays } : {}),
  };
}

/** The document `initializeStorageDocument` takes: `TripStorage` built as live objects, then flattened. */
export function toStorageLson(json: SoloStorageJson): PlainLsonObject {
  const root = new LiveObject<TripStorage>({
    members: new LiveMap(Object.entries(json.members).map(([id, m]) => [id, new LiveObject(m)])),
    stops: new LiveMap(Object.entries(json.stops).map(([id, s]) => [id, new LiveObject(s)])),
    legs: new LiveMap(
      Object.entries(json.legs).map(([id, l]) => [id, new LiveObject<Leg>({ ...l, votes: new LiveMap(Object.entries(l.votes)) })]),
    ),
    ...(json.stays ? { stays: new LiveMap(Object.entries(json.stays).map(([id, s]) => [id, new LiveObject(s)])) } : {}),
  });
  return toPlainLson(root) as PlainLsonObject;
}
