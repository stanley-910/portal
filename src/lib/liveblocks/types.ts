import type { LiveList, LiveMap, LiveObject } from "@liveblocks/client";

import type { AgentEvent, AgentRun, AgentUsage, Changeset, ThreadMessage } from "@/lib/agent/types";

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
    /** What they're riding while they draw: the globe's guess from the leg's shape. */
    vehicle?: "flight" | "train" | "bus" | "ferry";
  } | null;
  /** The cursor this member picked (profile menu), so others see theirs in it. Missing for older clients: the arrow. */
  shape?: "arrow" | "compass" | "map";
  /** Only Pip sets this (from the server): what it's doing, shown beside its cursor. */
  activity?: string | null;
};

/** What others see of a member. The Liveblocks user id is a Supabase user id, or a guest id (`g_…`). */
export type MemberInfo = {
  /** The account or guest display name. */
  name: string;
  /** 1 to MEMBER_COLORS: the colour they picked, else one handed out in join order. Rendered as `var(--member-<n>)`. */
  color: number;
};

/** A member as the trip stores them: what others see, plus their plan. */
export type TripMember = MemberInfo & {
  /** ISO-3 passport countries the member may travel on. Shared so Pip can compare entry rules per person. */
  nationalities?: string[];
  /** YYYY-MM-DD they leave the trip; the last night they pay for is the one before. Unset means they stay to the end. */
  leaves?: string | null;
};

/**
 * Somewhere some of the group sleep: a stop, the nights there, who stays and what it costs. Apart from the legs, so
 * people can ride a leg without staying, stay without riding it, and leave one without the other.
 *
 * Rooms made before stays had their own guests and dates have entries keyed by stop id with only `nightly`, `label`
 * and `estimated`; their nights came from who rode in. Read stays through `staysOf` (`@/lib/trip/split`), which turns
 * those into whole stays, and write whole stays back.
 */
export type Stay = {
  /** The stop it's at. */
  stop?: string;
  /** YYYY-MM-DD, the first night. */
  checkIn?: string;
  /** YYYY-MM-DD, the morning they leave: the last night is the one before. */
  checkOut?: string;
  /** Member ids sleeping there. Each night's cost is split among them. */
  guests?: string[];
  /** For the whole stay per night, split among its guests. Null means not known yet. */
  nightly: { amount: number; currency: string } | null;
  /** e.g. "Shinjuku apartment". */
  label: string | null;
  /** True when `nightly` is the hotel search's estimate rather than a price someone gave. */
  estimated?: boolean;
  /** What to search for to book it, outside the app. Absent on stays typed in by hand and older rooms. */
  listing?: { city: string; place?: string };
  createdAt?: number;
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
  /** The provider's test inventory: bookable in its sandbox, never a real flight. Carries no badge. */
  sandbox?: boolean;
  /** Refundable before departure, for this fee per passenger (null: free). Absent: not refundable, or not said. */
  refund?: { fee: { amount: number; currency: string } | null };
  price: { amount: number; currency: string } | null;
  carrier: string | null;
  /** The first segment's airline IATA code, for its logo. Absent on older rooms and non-flights. */
  carrierCode?: string;
  depart: string;
  arrive: string;
  durationMin: number;
  /** Segments after the first, e.g. a connecting flight. */
  stops: number;
  /**
   * The station a train, bus or ferry leaves from and gets to. Searches look at nearby cities too, so a Hong Kong
   * leg can list a train from Shenzhen North; the station says so. Absent for flights and older rooms.
   */
  departs?: string;
  arrives?: string;
  bookingUrl: string | null;
  attribution: string | null;
  /** Each flight's number, airports and local departure, when the provider gave them all. Settling matches on these. */
  flights?: { number: string; from: string; to: string; depart: string }[];
  /** Where it changes planes or trains on the way, in order, so the globe can route it through them. Absent when direct. */
  layovers?: { code: string; lat: number; lng: number }[];
};

export type LegSearch = {
  /** Changes on every new search, so a slow search that finishes after an edit can't overwrite the new one. */
  id: string;
  status: "searching" | "done" | "failed";
  offers: StoredOffer[];
};

export type Money = { amount: number; currency: string };

/** One rider's seat in a leg's booking. Status only: names and passports never enter the room. */
export type BookingSeat = {
  /** What this rider pays: the order total split evenly, with the rounding remainder on whoever settled. */
  share: Money;
  /** Traveller details submitted. */
  details: boolean;
  /** Group: their card is held. Separate: their ticket is bought. */
  paid: boolean;
  /** Separate tickets: this rider's own order and airline reference. */
  orderId?: string | null;
  reference?: string | null;
};

/**
 * A leg being bought through Duffel (docs/booking/README.md). Absent means the leg is still being planned. Only the
 * server writes it, so a client can't mark itself paid.
 */
export type LegBooking = {
  /** group: all or nothing on one held order. separate: each rider buys their own seat straight away. */
  mode: "group" | "separate";
  status: "details" | "paying" | "booked";
  /** The Duffel offer settled on: one seat per rider, matched to the chosen option by flight numbers. */
  offerId: string;
  /** The airport pair and date the offer was searched for, so the server can search again when it expires. */
  route: { origin: string; destination: string; date: string };
  /** The settled flights. Duffel stops serving an offer once it expires, so later steps search for these again. */
  flights?: { number: string; from: string; to: string; departingAt: string }[];
  /** Group: the hold order, once every rider's details are in. */
  orderId?: string | null;
  /** ISO 8601. Group: when the hold and the card holds lapse. Null for separate tickets. */
  deadline?: string | null;
  /** The whole order, per the airline. */
  total: Money;
  /** Whether the airline wants a passport for this flight. */
  documents: boolean;
  /** Rider id → their seat. */
  seats: Record<string, BookingSeat>;
  /** Group: the airline booking reference, once bought. */
  reference?: string | null;
  settledBy: string;
  settledAt: number;
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
  /** Set while the leg is being bought and once it is. Missing or null while planning. */
  booking?: LegBooking | null;
  /** Why the last booking stopped, e.g. the deadline passed. Cleared on the next settle or when dismissed. */
  bookingNotice?: string | null;
};

export type TripStorage = {
  /** Everyone who has joined, including people who are offline, so riders and the cost split can name them. */
  members: LiveMap<string, LiveObject<TripMember>>;
  stops: LiveMap<string, LiveObject<Stop>>;
  legs: LiveMap<string, LiveObject<Leg>>;
  /** Stay id → where some of the group sleep (`Stay`). Missing in rooms nobody has added a stay to. */
  stays?: LiveMap<string, LiveObject<Stay>>;
  /**
   * Who owns the trip, kept here so the room sees it pass on live. The room's metadata is what the server trusts;
   * leaving writes both. Unset in rooms whose owner never changed: then it's whoever made the trip.
   */
  owner?: string | null;
  /** YYYY-MM-DD the trip ends. Only rooms from before stays had their own dates read it, for their nights. */
  ends?: string | null;
  /** The trip's one thread, people and Pip. Missing in rooms made before it; created on first message. */
  thread?: LiveList<LiveObject<ThreadMessage>>;
  /** Pip's current run, if any. */
  agentRun?: AgentRun | null;
  /** Pip's model runs today, for the daily limit. */
  agentUsage?: AgentUsage;
  /** Changeset id → the plan before that run changed it. */
  changesets?: LiveMap<string, Changeset>;
};

/** Sent by the server only (`user` is null on it): the owner ended the trip and its room is being deleted. */
export type TripEvent = { type: "trip-ended" };

declare global {
  interface Liveblocks {
    Presence: TripPresence;
    Storage: TripStorage;
    UserMeta: { id: string; info: MemberInfo };
    RoomEvent: AgentEvent | TripEvent;
  }
}

/** How many member colours the design system defines (`member-1` to `member-6`). */
export const MEMBER_COLORS = 6;

/** Each trip is one room. The id is unguessable, so the trip's URL is its invite. */
export const tripRoomId = (tripId: string) => `trip:${tripId}`;

/** 16 base64url characters: 96 random bits. */
export const TRIP_ID = /^[A-Za-z0-9_-]{16}$/;

/** A saved member colour (1 to MEMBER_COLORS), from a number or a cookie's string; null when it isn't one. */
export function asMemberColor(value: unknown): number | null {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MEMBER_COLORS ? n : null;
}

/** The member's colour, falling back to ink until the design system defines member colours. */
export const memberColor = (n: number) => `var(--member-${n}, var(--ink))`;
