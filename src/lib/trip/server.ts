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
import { libraryTripOf, type LibraryTrip } from "./library";

export type TripSummary = {
  id: string;
  title: string;
  members: number;
  updatedAt: string;
  /** Whether the user the list is for owns the trip. Set only when the list is for someone. */
  owner?: boolean;
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
 * How long the library waits for any one trip's plan. The plans are read side by side, so the slowest sets the
 * list's time; a trip whose plan is later than this is listed without its legs rather than holding up the rest.
 */
export const PLAN_READ_MS = 2_500;

/**
 * The person's trips for the library sidebar: each trip's legs, stops and people, who is in its room now, and their
 * share. Plans and presence are read four trips at a time under one `PLAN_READ_MS` budget, after the room list's own; a trip whose plan is late
 * lists with no legs rather than holding up the rest. Liveblocks being down gives an empty list, never an error.
 */
export async function listMyLibrary(userId: string): Promise<LibraryTrip[]> {
  try {
    const { data } = await liveblocks().getRooms({ userId, limit: 100 }, { signal: AbortSignal.timeout(PLAN_READ_MS) });
    const summaries = toTripSummaries(data.filter((room) => room.id.startsWith("trip:")), userId);
    const read = createLimiter(4);
    const deadline = AbortSignal.timeout(PLAN_READ_MS);
    return await Promise.all(
      summaries.map(async (summary) => {
        const [plan, present] = await read(
          () =>
            Promise.all([
              readPlan(summary.id, deadline),
              liveblocks()
                .getActiveUsers(tripRoomId(summary.id), { signal: deadline })
                .then(({ data: users }) => new Set(users.map((u) => u.id).filter((id): id is string => !!id)))
                .catch(() => new Set<string>()),
            ]),
          deadline,
        ).catch(() => [{}, new Set<string>()] as const);
        return libraryTripOf({ id: summary.id, title: summary.title, owner: summary.owner ?? false, updatedAt: summary.updatedAt, plan, present }, userId);
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
  // a room keeps a snapped end on its leg (`Leg.snap`), not on the stop legs share
  const stopAt = (snapped: Stop) => {
    const stop = { ...snapped };
    delete stop.snapped;
    const found = Object.entries(stops).find(([, s]) => sharesStop(s, stop));
    if (found) return found[0];
    const id = newId();
    stops[id] = stop;
    return id;
  };
  const snapOf = (stop: Stop) => (stop.snapped && stop.hub ? stop.hub : undefined);
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
      ...(snapOf(leg.from) || snapOf(leg.to) ? {
        snap: { ...(snapOf(leg.from) ? { from: snapOf(leg.from) } : {}), ...(snapOf(leg.to) ? { to: snapOf(leg.to) } : {}) },
      } : {}),
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
