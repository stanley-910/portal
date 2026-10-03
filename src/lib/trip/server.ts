import "server-only";

import { LiveMap, LiveObject, toPlainLson } from "@liveblocks/client";
import type { PlainLsonObject, RoomData } from "@liveblocks/node";
import { z } from "zod";

import { liveblocks } from "@/lib/liveblocks/server";
import { tripRoomId, type Leg, type MemberInfo, type Stop, type TripStorage } from "@/lib/liveblocks/types";
import type { Offer, ProviderId } from "@/lib/transport/types";

import { MAX_OFFERS, toStoredOffer, webUrlOrNull } from "./offers";
import { sameStop } from "./stops";

export type TripSummary = { id: string; title: string; members: number; updatedAt: string };

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

/** Room list rows, newest activity first. `members` metadata may be a string or an array. */
export function toTripSummaries(rooms: Pick<RoomData, "id" | "metadata" | "createdAt" | "lastConnectionAt">[]): TripSummary[] {
  return rooms
    .map((room) => ({
      id: room.id.replace(/^trip:/, ""),
      title: asString(room.metadata.title) ?? "New trip",
      members: asList(room.metadata.members).length,
      updatedAt: asString(room.metadata.updatedAt) ?? (room.lastConnectionAt ?? room.createdAt).toISOString(),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The trips this user belongs to. Liveblocks being down gives an empty list, never an error. */
export async function listMyTrips(userId: string): Promise<TripSummary[]> {
  try {
    const { data } = await liveblocks().getRooms({ userId });
    return toTripSummaries(data.filter((room) => room.id.startsWith("trip:")));
  } catch {
    return [];
  }
}

// ---- Solo save from `/` (ADR-P08 on main's model, ADR-P13) ----

const PROVIDERS = ["travelpayouts", "12go", "tdx", "korea-tago", "china-rail", "busonlineticket", "gtfs", "srt"] as const satisfies readonly ProviderId[];
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
export const soloSaveSchema = z
  .object({
    from: stopSchema,
    to: stopSchema,
    date: z.iso.date().refine((d) => d >= isoDay(Date.now() - DAY) && d <= isoDay(Date.now() + 400 * DAY), "date out of range"),
    offers: z.array(offerSchema).min(1).max(MAX_OFFERS),
    chosen: text(200),
  })
  .refine((v) => !sameStop(v.from, v.to), "from and to are the same place")
  .refine((v) => v.offers.some((o) => o.id === v.chosen), "chosen offer is not among the options")
  .refine((v) => new Set(v.offers.map((o) => o.id)).size === v.offers.length, "duplicate offers")
  .refine((v) => JSON.stringify(v.offers).length <= MAX_OFFERS_CHARS, "options too large");

export type SoloSaveInput = z.infer<typeof soloSaveSchema>;

/** Storage as `getStorageDocument(room, "json")` returns it, for the parts a solo save writes. */
export type SoloStorageJson = {
  members: Record<string, MemberInfo>;
  stops: Record<string, Stop>;
  legs: Record<string, Omit<Leg, "votes"> & { votes: Record<string, string> }>;
};

/**
 * A trip with one leg whose search is already done (the options `/` showed) and the picked offer chosen, drawn and
 * ridden by the saver, who is member colour 1.
 */
export function buildSoloStorage(
  input: SoloSaveInput,
  user: { id: string; displayName: string },
  ids: { from: string; to: string; leg: string; search: string },
  now: number,
): SoloStorageJson {
  return {
    members: { [user.id]: { name: user.displayName, color: 1 } },
    stops: { [ids.from]: input.from, [ids.to]: input.to },
    legs: {
      [ids.leg]: {
        from: ids.from,
        to: ids.to,
        date: input.date,
        createdBy: user.id,
        riders: [user.id],
        // the schema checked each offer's fields; `provider` is a ProviderId there too
        search: { id: ids.search, status: "done", offers: input.offers.map((o) => toStoredOffer(o as Offer)) },
        votes: {},
        chosen: input.chosen,
        createdAt: now,
      },
    },
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
  });
  return toPlainLson(root) as PlainLsonObject;
}
