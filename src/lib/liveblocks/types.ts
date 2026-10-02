import type { LiveMap, LiveObject } from "@liveblocks/client";

// Shared shapes for the trip room. Decisions: docs/multiplayer/decisions.md (M3, M4, M8, M13, M14).
// Type aliases, not interfaces: Liveblocks needs them to be assignable to its JSON object type.
export type TripPresence = {
  /** The place under this member's pointer. Never screen pixels: everyone's view of the globe differs. */
  cursor: { lat: number; lng: number } | null;
  /** The trip this member is drawing (M14 step 2). Once it lands it's stored as a leg, so others ignore it then. */
  flight: {
    origin: { lat: number; lng: number };
    at: { lat: number; lng: number };
    ahead: { lat: number; lng: number };
    landed: boolean;
  } | null;
};

export type MemberInfo = {
  name: string;
  /** 1 to MEMBER_COLORS, in join order. Rendered as `var(--member-<n>)`. */
  color: number;
};

/** An exact clicked place legs start or end at (M8); preview hubs never move the point. */
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
 * One route option as stored for everyone (M13): the fields the plan shows, trimmed from the transport `Offer` so a
 * room stays small. `kind` is how fresh the data is; anything not "live" shows as estimated.
 */
export type StoredOffer = {
  id: string;
  provider: string;
  mode: "flight" | "train" | "bus" | "ferry";
  kind: "live" | "cached" | "timetable";
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
  /** Guest id of whoever drew it. */
  createdBy: string;
  /** Guest ids of who travels on this leg (M10). Defaults to whoever drew it. */
  riders: string[];
  search: LegSearch;
  /** Guest id → offer id: one vote per member. */
  votes: LiveMap<string, string>;
  chosen: string | null;
  createdAt: number;
};

export type TripStorage = {
  /** Everyone who has joined, including people who are offline, so riders and the cost split can name them. */
  members: LiveMap<string, LiveObject<MemberInfo>>;
  stops: LiveMap<string, LiveObject<Stop>>;
  legs: LiveMap<string, LiveObject<Leg>>;
};

declare global {
  interface Liveblocks {
    Presence: TripPresence;
    Storage: TripStorage;
    UserMeta: { id: string; info: MemberInfo };
  }
}

/** How many member colours the design system defines (`member-1` to `member-6`). */
export const MEMBER_COLORS = 6;

/** Each trip is one room. The id is unguessable, so the trip's URL is its invite (M7). */
export const tripRoomId = (tripId: string) => `trip:${tripId}`;

/** 16 base64url characters: 96 random bits. */
export const TRIP_ID = /^[A-Za-z0-9_-]{16}$/;

/** The member's colour, falling back to ink until the design system defines member colours. */
export const memberColor = (n: number) => `var(--member-${n}, var(--ink))`;
