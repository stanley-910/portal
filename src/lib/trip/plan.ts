"use client";

import { LiveList, LiveMap, LiveObject } from "@liveblocks/client";
import { shallow, useMutation, useRoom, useSelf, useStorage } from "@liveblocks/react";
import { useCallback, useEffect } from "react";

import { searchLeg } from "@/app/t/actions";
import { refreshTripTitle } from "@/app/t/title-actions";
import type { LandedTrip } from "@/components/trip-globe";
import type { LegBooking, LegSearch, Stop, StoredOffer, TripStorage } from "@/lib/liveblocks/types";
import { computeSplit, type MemberSplit, type Split, type SplitInput } from "./split";
import { sameStop, stopFromPoint } from "@/lib/trip/stops";

// The shared trip plan: stops, the legs between them, and each leg's options, votes and pick. Presentation
// lives in components; these hooks are the only place that writes the plan, so every edit follows M12.

/** What a new trip room's Storage starts as. Pass to `RoomProvider`. */
export const initialTripStorage = (): TripStorage => ({
  members: new LiveMap(),
  stops: new LiveMap(),
  legs: new LiveMap(),
  // made with the room, so posts never race to create it (lib/agent/run.ts)
  thread: new LiveList([]),
});

const newId = () => crypto.randomUUID().slice(0, 8);
const pending = (): LegSearch => ({ id: newId(), status: "searching", offers: [] });
/** YYYY-MM-DD in the browser's time zone. */
const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** How an edit went: applied, or why not (the leg or stop was removed, it's being booked, or its options changed). */
export type EditResult = "ok" | "gone" | "locked" | "replaced";

export type PlanLeg = {
  id: string;
  from: Stop & { id: string };
  to: Stop & { id: string };
  date: string;
  createdBy: string;
  riders: string[];
  search: LegSearch;
  /** Offer id → guest ids who voted for it. */
  votes: Record<string, string[]>;
  chosen: StoredOffer | null;
  createdAt: number;
  booking: LegBooking | null;
  bookingNotice: string | null;
};

/** Every leg in drawing order, with its stops filled in. Re-renders only when the plan changes. */
export function usePlanLegs(): PlanLeg[] | null {
  return useStorage((root) => {
    const legs: PlanLeg[] = [];
    for (const [id, leg] of Object.entries(root.legs)) {
      const from = root.stops[leg.from];
      const to = root.stops[leg.to];
      if (!from || !to) continue;
      const votes: Record<string, string[]> = {};
      for (const [who, offer] of Object.entries(leg.votes)) (votes[offer] ??= []).push(who);
      legs.push({
        id,
        from: { id: leg.from, ...from },
        to: { id: leg.to, ...to },
        date: leg.date,
        createdBy: leg.createdBy,
        riders: leg.riders,
        search: leg.search,
        votes,
        chosen: leg.search.offers.find((o) => o.id === leg.chosen) ?? null,
        createdAt: leg.createdAt,
        booking: leg.booking ?? null,
        bookingNotice: leg.bookingNotice ?? null,
      });
    }
    return legs.sort((a, b) => a.createdAt - b.createdAt);
  }, legsEqual);
}

/** Everyone who has joined the trip, online or not: guest id → name and colour. */
export function usePlanMembers() {
  return useStorage((root) => root.members);
}

export function usePlanStays() {
  return useStorage((root) => root.stays ?? {});
}

/** Who pays what, for the whole group: every night with who was there, and each member's fares, night shares and totals. */
export function useSplit(): Split | null {
  return useStorage((root): Split => {
    const input: SplitInput = {
      members: Object.fromEntries(Object.entries(root.members).map(([memberId, member]) => [memberId, { leaves: member.leaves }])),
      legs: Object.fromEntries(
        Object.entries(root.legs).map(([legId, leg]) => [
          legId,
          { from: leg.from, to: leg.to, date: leg.date, riders: leg.riders, search: leg.search, chosen: leg.chosen, createdAt: leg.createdAt, booking: leg.booking },
        ]),
      ),
      stays: root.stays,
      ends: root.ends,
    };
    return computeSplit(input);
  }, splitEqual);
}

/** The current member's live fare and lodging total. Recomputes whenever another member changes presence. */
export function useMySplit(): MemberSplit | null {
  const id = useSelf((self) => self.id);
  const split = useSplit();
  return (id && split?.members[id]) || null;
}

export function usePlanEnd() {
  return useStorage((root) => root.ends ?? null);
}

/** Records you in the trip's member list, and keeps your name and colour there current. Call once in the room. */
export function useRecordMember(nationalities: string[] = []) {
  const ready = usePlanReady();
  const me = useSelf((self) => ({ id: self.id, name: self.info.name, color: self.info.color }), shallow);
  const record = useMutation(({ storage }, who: { id: string; name: string; color: number; nationalities: string[] }) => {
    const members = storage.get("members");
    const current = members.get(who.id);
    if (!current) members.set(who.id, new LiveObject({ name: who.name, color: who.color, nationalities: who.nationalities }));
    else if (
      current.get("name") !== who.name ||
      current.get("color") !== who.color ||
      (current.get("nationalities") ?? []).join(",") !== who.nationalities.join(",")
    ) {
      current.update({ name: who.name, color: who.color, nationalities: who.nationalities });
    }
  }, []);
  const id = me?.id;
  const name = me?.name;
  const color = me?.color;
  // by value: a new array each render would otherwise rerun this every render
  const passports = nationalities.join(",");
  useEffect(() => {
    if (ready && id && name !== undefined && color !== undefined) {
      record({ id, name, color, nationalities: passports ? passports.split(",") : [] });
    }
  }, [record, ready, id, name, color, passports]);
}

/** False until the plan has loaded. Edits before then throw, so gate them on this. */
export function usePlanReady() {
  return useStorage(() => true) ?? false;
}

/** Every edit to the plan. Edits that change where or when a leg goes start a new search for it. */
export function usePlanActions() {
  const room = useRoom();
  const tripId = room.id.slice("trip:".length);
  const search = useCallback(
    (legId: string, searchId: string) => {
      void searchLeg(tripId, legId, searchId);
    },
    [tripId],
  );

  /**
   * Re-derives the trip's title for "My trips" once the edit has had a moment to reach the server's copy of Storage.
   * Fire and forget: a failed refresh only leaves the old title.
   */
  const retitle = useCallback(() => {
    setTimeout(() => {
      refreshTripTitle(tripId).catch(() => {});
    }, 1500);
  }, [tripId]);

  /** Stores a landed trip at its exact clicks, sharing only identical stops. */
  const addLegMutation = useMutation(({ storage, self }, trip: LandedTrip) => {
    const stops = storage.get("stops");
    const stopAt = (stop: Stop) => {
      for (const [id, s] of stops) {
        if (sameStop({ lat: s.get("lat"), lng: s.get("lng"), hub: s.get("hub") }, stop)) return id;
      }
      const id = newId();
      stops.set(id, new LiveObject(stop));
      return id;
    };
    const id = newId();
    const search = pending();
    storage.get("legs").set(
      id,
      new LiveObject({
        from: stopAt(stopFromPoint(trip.origin, trip.from)),
        to: stopAt(stopFromPoint(trip.destination, trip.to)),
        date: localDate(trip.departDate),
        createdBy: self.id,
        riders: [self.id],
        search,
        votes: new LiveMap<string, string>(),
        chosen: null,
        createdAt: Date.now(),
      }),
    );
    return { id, searchId: search.id };
  }, []);

  /** Starts a fresh search for a leg, dropping its old options, votes and pick. */
  const resetMutation = useMutation(({ storage }, legId: string, patch: { date?: string }) => {
    const leg = storage.get("legs").get(legId);
    // a settled leg's options are fixed until its booking is cancelled
    if (!leg || leg.get("booking")) return null;
    const search = pending();
    leg.update({ ...patch, search, chosen: null });
    const votes = leg.get("votes");
    for (const who of [...votes.keys()]) votes.delete(who);
    return search.id;
  }, []);

  const voteMutation = useMutation(({ storage, self }, legId: string, offerId: string) => {
    const votes = storage.get("legs").get(legId)?.get("votes");
    if (!votes) return;
    if (votes.get(self.id) === offerId) votes.delete(self.id);
    else votes.set(self.id, offerId);
  }, []);

  /** Picks an option for everyone. Says why when it can't, so the panel can tell the member rather than do nothing. */
  const chooseMutation = useMutation(({ storage }, legId: string, offerId: string | null): EditResult => {
    const leg = storage.get("legs").get(legId);
    if (!leg) return "gone";
    if (leg.get("booking")) return "locked";
    // a search that finished or restarted since the member clicked has replaced the options
    if (offerId !== null && !leg.get("search").offers.some((o) => o.id === offerId)) return "replaced";
    leg.set("chosen", offerId);
    return "ok";
  }, []);
  /** Sets what lodging at a stop costs the group a night. Rooms made before stays, or saved from `/` without a hotel, have no map yet. */
  const setStayMutation = useMutation(({ storage }, stopId: string, stay: { label: string; nightly: { amount: number; currency: string }; estimated?: boolean } | null): EditResult => {
    if (!storage.get("stops").get(stopId)) return "gone";
    let stays = storage.get("stays");
    if (!stays) storage.set("stays", (stays = new LiveMap()));
    if (stay) stays.set(stopId, new LiveObject({ ...stay, estimated: stay.estimated ?? true }));
    else stays.delete(stopId);
    return "ok";
  }, []);

  const toggleRiderMutation = useMutation(({ storage }, legId: string, guestId: string) => {
    const leg = storage.get("legs").get(legId);
    if (!leg || leg.get("booking")) return;
    const riders = leg.get("riders");
    leg.set("riders", riders.includes(guestId) ? riders.filter((r) => r !== guestId) : [...riders, guestId]);
  }, []);

  const setLeaveMutation = useMutation(({ storage, self }, date: string | null) => {
    storage.get("members").get(self.id)?.set("leaves", date);
  }, []);
  const setEndsMutation = useMutation(({ storage }, date: string | null) => {
    storage.set("ends", date);
  }, []);

  /** Removes a leg, and any stop no other leg uses. */
  const removeLegMutation = useMutation(({ storage }, legId: string) => {
    const legs = storage.get("legs");
    const leg = legs.get(legId);
    if (!leg || leg.get("booking")) return;
    legs.delete(legId);
    const used = new Set<string>();
    for (const l of legs.values()) used.add(l.get("from")).add(l.get("to"));
    for (const stop of [leg.get("from"), leg.get("to")]) if (!used.has(stop)) storage.get("stops").delete(stop);
  }, []);

  return {
    addLeg: (trip: LandedTrip) => {
      const { id, searchId } = addLegMutation(trip);
      search(id, searchId);
      retitle();
      return id;
    },
    setDate: (legId: string, date: string) => {
      const searchId = resetMutation(legId, { date });
      if (searchId) search(legId, searchId);
      retitle();
    },
    retrySearch: (legId: string) => {
      const searchId = resetMutation(legId, {});
      if (searchId) search(legId, searchId);
    },
    vote: voteMutation,
    choose: chooseMutation,
    setStay: setStayMutation,
    toggleRider: toggleRiderMutation,
    setLeave: (date: string | null) => setLeaveMutation(date),
    setEnds: (date: string | null) => setEndsMutation(date),
    removeLeg: (legId: string) => {
      removeLegMutation(legId);
      retitle();
    },
  };
}

function splitEqual(a: Split | null, b: Split | null) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function legsEqual(a: PlanLeg[] | null, b: PlanLeg[] | null) {
  return JSON.stringify(a) === JSON.stringify(b);
}
