import "server-only";
import { createLimiter } from "@/lib/concurrency";

import { LiveList, LiveMap, LiveObject, toPlainLson } from "@liveblocks/client";
import type { PlainLsonObject, RoomData } from "@liveblocks/node";

import { liveblocks } from "@/lib/liveblocks/server";
import { tripRoomId, type Leg, type MemberInfo, type Stay, type Stop, type TripStorage } from "@/lib/liveblocks/types";
import { arrivalDate } from "@/lib/transport/arrival";
import type { Offer } from "@/lib/transport/types";

import { stayDates } from "./leg-edit";
import { tripOwner } from "./leave";
import { toStoredOffer } from "./offers";
import { sharesStop } from "./stops";
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

/** The saved plan of a trip room as plain JSON. Unreadable Storage, or a read `signal` cut short, reads as an empty plan. */
export async function readPlan(tripId: string, signal?: AbortSignal): Promise<unknown> {
  try {
    return await liveblocks().getStorageDocument(tripRoomId(tripId), "json", signal ? { signal } : undefined);
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

/**
 * How long the trips list waits for any one trip's plan. The plans are read side by side, so the slowest sets the
 * page's time; a trip whose plan is later than this is listed without its costs rather than holding up the rest.
 */
export const PLAN_READ_MS = 2_500;

/** The trips this user belongs to. Liveblocks being down gives an empty list, never an error. */
export async function listTripMetadata(userId: string): Promise<TripSummary[]> {
  try {
    const { data } = await liveblocks().getRooms({ userId }, { signal: AbortSignal.timeout(PLAN_READ_MS) });
    return toTripSummaries(data.filter((room) => room.id.startsWith("trip:")), userId);
  } catch { return []; }
}

/** Metadata can render before enrichment; cost reads have a shared budget and bounded concurrency. */
export async function listMyTrips(userId: string, metadata?: TripSummary[]): Promise<TripSummary[]> {
  try {
    const summaries = metadata ?? await listTripMetadata(userId);
    const read = createLimiter(4);
    const deadline = AbortSignal.timeout(PLAN_READ_MS);
    return await Promise.all(
      summaries.map(async (summary) => {
        try {
          const plan = (await read(() => readPlan(summary.id, deadline), deadline)) as SplitInput & { stops?: Record<string, { name: string }> };
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

export { soloLegSchema, soloSaveSchema, MAX_SOLO_LEGS } from "./solo-schema";
export type { SoloSaveInput } from "./solo-schema";
import type { SoloSaveInput } from "./solo-schema";

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
    const found = Object.entries(stops).find(([, s]) => sharesStop(s, stop));
    if (found) return found[0];
    const id = newId();
    stops[id] = stop;
    return id;
  };
  const picked: { to: string; date: string; arrival: string; stay: NonNullable<SoloSaveInput["legs"][number]["stay"]> }[] = [];
  input.legs.forEach((leg, i) => {
    const from = stopAt(leg.from);
    const to = stopAt(leg.to);
    const offers = leg.offers.map((o) => toStoredOffer(o as Offer));
    legs[newId()] = {
      from,
      to,
      date: leg.date,
      createdBy: user.id,
      riders: [user.id],
      // the schema checked each offer's fields; `provider` is a ProviderId there too
      search: { id: newId(), status: "done", offers },
      votes: {},
      chosen: leg.chosen,
      // in order, so legs on the same day keep the order they were flown in
      createdAt: now + i,
    };
    if (leg.stay) picked.push({ to, date: leg.date, arrival: arrivalDate(leg.date, offers.find((o) => o.id === leg.chosen)), stay: leg.stay });
  });
  // a hotel picked on `/` is for the saver, from the leg's arrival to their next leg out of there, else one night
  const legList = Object.values(legs);
  for (const p of picked) {
    const { checkIn, checkOut } = stayDates(legList, { to: p.to, date: p.date, arrival: p.arrival, riders: [user.id] });
    stays[newId()] = { stop: p.to, checkIn, checkOut, guests: [user.id], ...p.stay, createdAt: now };
  }
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
    // made with the room, so posts to Pip never race to create it (lib/agent/run.ts)
    thread: new LiveList([]),
  });
  return toPlainLson(root) as PlainLsonObject;
}
