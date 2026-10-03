import type { LiveList, LiveMap, LiveObject } from "@liveblocks/client";

import type { AgentEvent, AgentRun, Changeset, ThreadMessage } from "@/lib/agent/types";

// Shared shapes for the trip room.
// Type aliases, not interfaces: Liveblocks needs them to be assignable to its JSON object type.
export type TripPresence = {
  /** The place under this member's pointer. Never screen pixels: everyone's view of the globe differs. */
  cursor: { lat: number; lng: number } | null;
  /** The trip this member is drawing. Once it lands it's stored as a leg, so others ignore it then. */
  flight: {
    origin: { lat: number; lng: number };
    at: { lat: number; lng: number };
    ahead: { lat: number; lng: number };
    landed: boolean;
  } | null;
  /** Only Pip sets this (from the server): what it's doing, shown beside its cursor. */
  activity?: string | null;
};

/** What others see of a member. The Liveblocks user id is a Supabase user id, or a guest id (`g_…`). */
export type MemberInfo = {
  /** The account or guest display name. */
  name: string;
  /** 1 to MEMBER_COLORS, in join order. Rendered as `var(--member-<n>)`. */
  color: number;
};

/** An exact clicked place legs start or end at; preview hubs never move the point. */
export type Stop = {
  lat: number;
  lng: number;
  /** Preview hub's catalog ID, not an IATA code; null outside bundled coverage. */
  hub: string | null;
  /** Display code only, not provider identity. Optional for rooms created before hub previews. */
  code?: string | null;
  name: string;
};

/**
 * One route option as stored for everyone: the fields the plan shows, trimmed from the transport `Offer` so a
 * room stays small. `kind` is how fresh the data is; anything not "live" shows as estimated.
 */
export type StoredOffer = {
  id: string;
  provider: string;
  mode: "flight" | "train" | "bus" | "ferry";
  kind: "live" | "cached" | "timetable" | "estimated";
  price: { amount: number; currency: string } | null;
  carrier: string | null;
  depart: string;
  arrive: string;
  durationMin: number;
  /** Segments after the first, e.g. a connecting flight. */
  stops: number;
  bookingUrl: string | null;
  attribution: string | null;
};

export type LegSearch = {
  /** Changes on every new search, so a slow search that finishes after an edit can't overwrite the new one. */
  id: string;
  status: "searching" | "done" | "failed";
  offers: StoredOffer[];
};

export type Leg = {
  from: string;
  to: string;
  /** YYYY-MM-DD, local date at the origin. */
  date: string;
  /** User id of whoever drew it. */
  createdBy: string;
  /** Person ids (account or guest) of who travels on this leg. Defaults to whoever drew it. */
  riders: string[];
  search: LegSearch;
  /** User id → offer id: one vote per member. */
  votes: LiveMap<string, string>;
  chosen: string | null;
  createdAt: number;
};

export type TripStorage = {
  /** Everyone who has joined, including people who are offline, so riders and the cost split can name them. */
  members: LiveMap<string, LiveObject<MemberInfo>>;
  stops: LiveMap<string, LiveObject<Stop>>;
  legs: LiveMap<string, LiveObject<Leg>>;
  /** The trip's one thread, people and Pip. Missing in rooms made before it; created on first message. */
  thread?: LiveList<LiveObject<ThreadMessage>>;
  /** Pip's current run, if any. */
  agentRun?: AgentRun | null;
  /** Changeset id → the plan before that run changed it. */
  changesets?: LiveMap<string, Changeset>;
};

declare global {
  interface Liveblocks {
    Presence: TripPresence;
    Storage: TripStorage;
    UserMeta: { id: string; info: MemberInfo };
    RoomEvent: AgentEvent;
  }
}

/** How many member colours the design system defines (`member-1` to `member-6`). */
export const MEMBER_COLORS = 6;

/** Each trip is one room. The id is unguessable, so the trip's URL is its invite. */
export const tripRoomId = (tripId: string) => `trip:${tripId}`;

/** 16 base64url characters: 96 random bits. */
export const TRIP_ID = /^[A-Za-z0-9_-]{16}$/;

/** The member's colour, falling back to ink until the design system defines member colours. */
export const memberColor = (n: number) => `var(--member-${n}, var(--ink))`;
