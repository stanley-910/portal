// Shared shapes for the trip room. Decisions: docs/multiplayer/decisions.md (M3, M4, M14).
// Type aliases, not interfaces: Liveblocks needs them to be assignable to its JSON object type.
export type TripPresence = {
  /** The place under this member's pointer. Never screen pixels: everyone's view of the globe differs. */
  cursor: { lat: number; lng: number } | null;
  /**
   * The trip this member is drawing (M14 step 2): takeoff, the plane, and whether it has landed. Lives in presence
   * until the trip model (M8) stores landed legs.
   */
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

declare global {
  interface Liveblocks {
    Presence: TripPresence;
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
