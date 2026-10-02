"use client";

import { LiveMap, LiveObject } from "@liveblocks/client";
import { shallow, useMutation, useRoom, useSelf, useStorage } from "@liveblocks/react";
import { useCallback, useEffect } from "react";

import { searchLeg } from "@/app/t/actions";
import type { LandedTrip } from "@/components/trip-globe";
import type { LegSearch, Stop, StoredOffer, TripStorage } from "@/lib/liveblocks/types";

// The shared trip plan (M8): stops, the legs between them, and each leg's options, votes and pick. Presentation
// lives in components; these hooks are the only place that writes the plan, so every edit follows M12.

/** What a new trip room's Storage starts as. Pass to `RoomProvider`. */
export const initialTripStorage = (): TripStorage => ({
  members: new LiveMap(),
  stops: new LiveMap(),
  legs: new LiveMap(),
});

const newId = () => crypto.randomUUID().slice(0, 8);
const pending = (): LegSearch => ({ id: newId(), status: "searching", offers: [] });
/** YYYY-MM-DD in the browser's time zone. */
const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

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
      });
    }
    return legs.sort((a, b) => a.createdAt - b.createdAt);
  }, legsEqual);
}

/** Everyone who has joined the trip, online or not: guest id → name and colour. */
export function usePlanMembers() {
  return useStorage((root) => root.members);
}

/** Records you in the trip's member list, and keeps your name and colour there current. Call once in the room. */
export function useRecordMember() {
  const ready = usePlanReady();
  const me = useSelf((self) => ({ id: self.id, name: self.info.name, color: self.info.color }), shallow);
  const record = useMutation(({ storage }, who: { id: string; name: string; color: number }) => {
    const members = storage.get("members");
    const current = members.get(who.id);
    if (!current) members.set(who.id, new LiveObject({ name: who.name, color: who.color }));
    else if (current.get("name") !== who.name || current.get("color") !== who.color) current.update({ name: who.name, color: who.color });
  }, []);
  const id = me?.id;
  const name = me?.name;
  const color = me?.color;
  useEffect(() => {
    if (ready && id && name !== undefined && color !== undefined) record({ id, name, color });
  }, [record, ready, id, name, color]);
}

/** False until the plan has loaded. Edits before then throw, so gate them on this. */
export function usePlanReady() {
  return useStorage(() => true) ?? false;
}

/** Every edit to the plan. Edits that change where or when a leg goes start a new search for it (M12). */
export function usePlanActions() {
  const room = useRoom();
  const tripId = room.id.slice("trip:".length);
  const search = useCallback(
    (legId: string, searchId: string) => {
      void searchLeg(tripId, legId, searchId);
    },
    [tripId],
  );

  /** Stores a landed trip as a leg, snapping each end onto an existing stop at the same hub (M8). */
  const addLegMutation = useMutation(({ storage, self }, trip: LandedTrip) => {
    const stops = storage.get("stops");
    const stopAt = (hub: { code: string; city: string; lat: number; lng: number }) => {
      for (const [id, s] of stops) if (s.get("hub") === hub.code) return id;
      const id = newId();
      stops.set(id, new LiveObject({ lat: hub.lat, lng: hub.lng, hub: hub.code, name: hub.city }));
      return id;
    };
    const id = newId();
    const search = pending();
    storage.get("legs").set(
      id,
      new LiveObject({
        from: stopAt(trip.from),
        to: stopAt(trip.to),
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

  /** Starts a fresh search for a leg, dropping its old options, votes and pick (M12). */
  const resetMutation = useMutation(({ storage }, legId: string, patch: { date?: string }) => {
    const leg = storage.get("legs").get(legId);
    if (!leg) return null;
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

  const chooseMutation = useMutation(({ storage }, legId: string, offerId: string | null) => {
    storage.get("legs").get(legId)?.set("chosen", offerId);
  }, []);

  const toggleRiderMutation = useMutation(({ storage }, legId: string, guestId: string) => {
    const leg = storage.get("legs").get(legId);
    if (!leg) return;
    const riders = leg.get("riders");
    leg.set("riders", riders.includes(guestId) ? riders.filter((r) => r !== guestId) : [...riders, guestId]);
  }, []);

  /** Removes a leg, and any stop no other leg uses. */
  const removeLegMutation = useMutation(({ storage }, legId: string) => {
    const legs = storage.get("legs");
    const leg = legs.get(legId);
    if (!leg) return;
    legs.delete(legId);
    const used = new Set<string>();
    for (const l of legs.values()) used.add(l.get("from")).add(l.get("to"));
    for (const stop of [leg.get("from"), leg.get("to")]) if (!used.has(stop)) storage.get("stops").delete(stop);
  }, []);

  return {
    addLeg: (trip: LandedTrip) => {
      const { id, searchId } = addLegMutation(trip);
      search(id, searchId);
      return id;
    },
    setDate: (legId: string, date: string) => {
      const searchId = resetMutation(legId, { date });
      if (searchId) search(legId, searchId);
    },
    retrySearch: (legId: string) => {
      const searchId = resetMutation(legId, {});
      if (searchId) search(legId, searchId);
    },
    vote: voteMutation,
    choose: chooseMutation,
    toggleRider: toggleRiderMutation,
    removeLeg: removeLegMutation,
  };
}

function legsEqual(a: PlanLeg[] | null, b: PlanLeg[] | null) {
  return JSON.stringify(a) === JSON.stringify(b);
}
