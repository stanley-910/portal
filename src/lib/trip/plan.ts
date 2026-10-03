"use client";

import { LiveList, LiveMap, LiveObject } from "@liveblocks/client";
import { shallow, useMutation, useRoom, useSelf, useStorage } from "@liveblocks/react";
import { useCallback, useEffect, useRef } from "react";

import { searchLeg } from "@/app/t/actions";
import { refreshTripTitle } from "@/app/t/title-actions";
import { localIso } from "@/components/ticket-search/parts";
import type { LandedTrip } from "@/components/trip-globe";
import type { LegBooking, LegSearch, Stay, Stop, StoredOffer, TripStorage } from "@/lib/liveblocks/types";
import * as dates from "./dates";
import { computeSplit, staysOf, type MemberSplit, type PlanStay, type Split, type SplitInput } from "./split";
import { sharesStop, stopFromPoint } from "@/lib/trip/stops";

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

/** Every stay, whole: where some of the group sleep, when, who and for what (`staysOf`). */
export function usePlanStays(): PlanStay[] | null {
  return useStorage(
    (root) =>
      staysOf({
        members: root.members,
        legs: root.legs as SplitInput["legs"],
        stays: root.stays as SplitInput["stays"],
        ends: root.ends,
      }),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
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
      stays: root.stays as SplitInput["stays"],
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

/** Just the dates: each leg's date and riders, leave dates and the trip's end. Feed it to `@/lib/trip/dates`. */
export function usePlanDates(): dates.DatePlan | null {
  return useStorage(
    (root) => ({
      legs: Object.fromEntries(
        Object.entries(root.legs).map(([id, l]) => [id, { date: l.date, riders: l.riders, createdAt: l.createdAt, booking: l.booking ?? null }]),
      ),
      members: Object.fromEntries(Object.entries(root.members).map(([id, m]) => [id, { leaves: m.leaves ?? null }])),
      ends: root.ends ?? null,
    }),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
}

type Root = LiveObject<TripStorage>;

/** The dates out of live Storage, as `@/lib/trip/dates` reads them. */
function datesIn(storage: Root): dates.DatePlan {
  return {
    legs: Object.fromEntries(
      [...storage.get("legs").entries()].map(([id, l]) => [id, { date: l.get("date"), riders: l.get("riders"), createdAt: l.get("createdAt"), booking: l.get("booking") ?? null }]),
    ),
    members: Object.fromEntries([...storage.get("members").entries()].map(([id, m]) => [id, { leaves: m.get("leaves") ?? null }])),
    ends: storage.get("ends") ?? null,
  };
}

/** Writes leave dates and the trip's end from `@/lib/trip/dates`. Leg dates go through `reset`, which searches again. */
function writeDates(storage: Root, changes: dates.DateChanges) {
  for (const [id, leaves] of Object.entries(changes.leaves)) storage.get("members").get(id)?.set("leaves", leaves);
  if (changes.ends !== undefined) storage.set("ends", changes.ends);
}

/**
 * Records you in the trip's member list and keeps your name and passports there current. Your colour is written
 * when you join and whenever the room hands you a new one (your saved colour, or one in join order); a colour you
 * pick in the room since then (`setColor`) stands. Call once in the room.
 */
export function useRecordMember(nationalities: string[] = []) {
  const ready = usePlanReady();
  const me = useSelf((self) => ({ id: self.id, name: self.info.name, color: self.info.color }), shallow);
  const record = useMutation(
    ({ storage }, who: { id: string; name: string; color: number; nationalities: string[] }, withColor: boolean) => {
      const members = storage.get("members");
      const current = members.get(who.id);
      if (!current) {
        members.set(who.id, new LiveObject({ name: who.name, color: who.color, nationalities: who.nationalities }));
        return;
      }
      const patch: { name?: string; color?: number; nationalities?: string[] } = {};
      if (current.get("name") !== who.name) patch.name = who.name;
      if ((current.get("nationalities") ?? []).join(",") !== who.nationalities.join(",")) patch.nationalities = who.nationalities;
      if (withColor && current.get("color") !== who.color) patch.color = who.color;
      if (Object.keys(patch).length) current.update(patch);
    },
    [],
  );
  const id = me?.id;
  const name = me?.name;
  const color = me?.color;
  // the colour last written from the room's token, so a rename or passport change doesn't undo a colour picked since
  const written = useRef<number | null>(null);
  // by value: a new array each render would otherwise rerun this every render
  const passports = nationalities.join(",");
  useEffect(() => {
    if (ready && id && name !== undefined && color !== undefined) {
      record({ id, name, color, nationalities: passports ? passports.split(",") : [] }, written.current !== color);
      written.current = color;
    }
  }, [record, ready, id, name, color, passports]);
}

/**
 * Everyone's member colour (1 to MEMBER_COLORS) as the trip stores it. The plan is where colours live in a room:
 * a colour picked there shows for everyone at once, which the colour on someone's connection can't.
 */
export function useMemberColors(): Record<string, number> | null {
  return useStorage(
    (root) => Object.fromEntries(Object.entries(root.members).map(([id, member]) => [id, member.color])),
    shallow,
  );
}

/** One member's colour (1 to MEMBER_COLORS): the stored one, else `fallback` (their connection's) until it's recorded. */
export function useMemberColor(id: string | null | undefined, fallback: number): number {
  return useStorage((root) => (id ? root.members[id]?.color : undefined)) ?? fallback;
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
        if (sharesStop({ lat: s.get("lat"), lng: s.get("lng"), hub: s.get("hub") }, stop)) return id;
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
        date: localIso(trip.departDate),
        createdBy: self.id,
        riders: [self.id],
        search,
        votes: new LiveMap<string, string>(),
        chosen: null,
        createdAt: Date.now(),
      }),
    );
    // a leg after the trip's end moves the end along
    writeDates(storage, dates.settle(datesIn(storage)));
    return { id, searchId: search.id };
  }, []);

  /** Starts a fresh search for a leg, dropping its old options, votes and pick. */
  const resetMutation = useMutation(({ storage }, legId: string, patch: { date?: string }) => reset(storage, legId, patch), []);

  /**
   * Moves a leg, pushing later legs its riders take along with it (`dates.moveLeg`). Returns the searches to start,
   * or null when a leg that would have to move is being booked, in which case nothing changes.
   */
  const setDateMutation = useMutation(({ storage }, legId: string, date: string) => {
    const changes = dates.moveLeg(datesIn(storage), legId, date);
    if (changes.blocked.length || storage.get("legs").get(legId)?.get("booking")) return null;
    const searches: { legId: string; searchId: string }[] = [];
    for (const [id, d] of Object.entries(changes.legs)) {
      const searchId = reset(storage, id, { date: d });
      if (searchId) searches.push({ legId: id, searchId });
    }
    writeDates(storage, changes);
    return searches;
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
  /** Adds a stay at a stop. Its guests and dates are its own; riding a leg there doesn't change them. */
  const addStayMutation = useMutation(({ storage }, stay: NewStay): EditResult => {
    if (!storage.get("stops").get(stay.stop)) return "gone";
    const stays = staysIn(storage);
    stays.set(newId(), new LiveObject<Stay>({ ...stay, estimated: stay.estimated ?? true, createdAt: Date.now() }));
    return "ok";
  }, []);
  /** Changes a stay: its dates, guests, hotel or price. A stay left with nobody in it is removed. */
  const updateStayMutation = useMutation(({ storage }, id: string, patch: Partial<NewStay>): EditResult => {
    const stay = staysIn(storage).get(id);
    if (!stay) return "gone";
    const next = { ...stay.toJSON(), ...patch };
    if (!next.checkIn || !next.checkOut || next.checkOut <= next.checkIn) return "ok";
    if (!next.guests?.length) staysIn(storage).delete(id);
    else stay.update(patch);
    return "ok";
  }, []);
  const removeStayMutation = useMutation(({ storage }, id: string) => {
    staysIn(storage).delete(id);
  }, []);

  const toggleRiderMutation = useMutation(({ storage }, legId: string, guestId: string) => {
    const leg = storage.get("legs").get(legId);
    if (!leg || leg.get("booking")) return;
    const riders = leg.get("riders");
    leg.set("riders", riders.includes(guestId) ? riders.filter((r) => r !== guestId) : [...riders, guestId]);
    // a rider's first leg may have moved, and their leave date with it
    writeDates(storage, dates.settle(datesIn(storage)));
  }, []);

  /** Your leave date, kept between your first leg and the trip's end (`dates.clampLeave`). */
  const setLeaveMutation = useMutation(({ storage, self }, date: string | null) => {
    storage.get("members").get(self.id)?.set("leaves", dates.clampLeave(datesIn(storage), self.id, date));
  }, []);
  /** The trip's end, never before its latest leg; leave dates after it come back to it. */
  /** Your member colour in this trip, 1 to MEMBER_COLORS. Saving it on you, for other trips, is the caller's job. */
  const setColorMutation = useMutation(({ storage, self }, color: number) => {
    storage.get("members").get(self.id)?.set("color", color);
  }, []);
  const setEndsMutation = useMutation(({ storage }, date: string | null) => {
    writeDates(storage, dates.setEnds(datesIn(storage), date));
  }, []);

  /**
   * Moves a stop to a new place, for everyone: every leg into or out of it searches again from there, and its stays
   * stay with it. Refused while one of those legs is being booked, since its flights are fixed.
   */
  const moveStopMutation = useMutation(({ storage }, stopId: string, to: Stop) => {
    const stop = storage.get("stops").get(stopId);
    if (!stop) return { result: "gone" as EditResult, searches: [] };
    const touching = [...storage.get("legs").entries()].filter(([, l]) => l.get("from") === stopId || l.get("to") === stopId);
    if (touching.some(([, l]) => l.get("booking"))) return { result: "locked" as EditResult, searches: [] };
    stop.update(to);
    const searches: { legId: string; searchId: string }[] = [];
    for (const [legId] of touching) {
      const searchId = reset(storage, legId, {});
      if (searchId) searches.push({ legId, searchId });
    }
    return { result: "ok" as EditResult, searches };
  }, []);

  /** Removes a leg, and any stop no other leg or stay uses. Its riders' stays stay. */
  const removeLegMutation = useMutation(({ storage }, legId: string) => {
    const legs = storage.get("legs");
    const leg = legs.get(legId);
    if (!leg || leg.get("booking")) return;
    legs.delete(legId);
    const used = new Set<string>();
    for (const l of legs.values()) used.add(l.get("from")).add(l.get("to"));
    // a stay keeps its stop: people can still be sleeping there without the leg
    for (const stay of staysIn(storage).values()) used.add(stay.get("stop")!);
    for (const stop of [leg.get("from"), leg.get("to")]) if (!used.has(stop)) storage.get("stops").delete(stop);
    writeDates(storage, dates.settle(datesIn(storage)));
  }, []);

  return {
    addLeg: (trip: LandedTrip) => {
      const { id, searchId } = addLegMutation(trip);
      search(id, searchId);
      retitle();
      return id;
    },
    /** False when a later leg that would have to move is being booked, so nothing changed. */
    setDate: (legId: string, date: string) => {
      const searches = setDateMutation(legId, date);
      if (!searches) return false;
      for (const s of searches) search(s.legId, s.searchId);
      retitle();
      return true;
    },
    retrySearch: (legId: string) => {
      const searchId = resetMutation(legId, {});
      if (searchId) search(legId, searchId);
    },
    vote: voteMutation,
    choose: chooseMutation,
    addStay: addStayMutation,
    updateStay: updateStayMutation,
    removeStay: removeStayMutation,
    toggleRider: toggleRiderMutation,
    setLeave: (date: string | null) => setLeaveMutation(date),
    setColor: (color: number) => setColorMutation(color),
    setEnds: (date: string | null) => setEndsMutation(date),
    /** Moves a stop for everyone; its legs search again. Says why when it can't. */
    moveStop: (stopId: string, to: Stop): EditResult => {
      const { result, searches } = moveStopMutation(stopId, to);
      for (const s of searches) search(s.legId, s.searchId);
      if (result === "ok") retitle();
      return result;
    },
    removeLeg: (legId: string) => {
      removeLegMutation(legId);
      retitle();
    },
  };
}

/** A stay as an edit gives it: everything but its id and when it was made. */
export type NewStay = Required<Pick<Stay, "stop" | "checkIn" | "checkOut" | "guests">> & Pick<Stay, "nightly" | "label" | "estimated">;

/**
 * The stays map, made if the room has none, with any stays from before stays had their own guests and dates written
 * out whole first (`staysOf`), so every edit after works on whole stays.
 */
function staysIn(storage: Root): LiveMap<string, LiveObject<Stay>> {
  let stays = storage.get("stays");
  if (!stays) storage.set("stays", (stays = new LiveMap()));
  if ([...stays.values()].some((s) => !s.get("stop"))) {
    const plan = storage.toJSON() as unknown as SplitInput;
    for (const id of [...stays.keys()]) if (!stays.get(id)!.get("stop")) stays.delete(id);
    for (const s of staysOf(plan)) {
      if (stays.has(s.id)) continue;
      const { id, ...stay } = s;
      stays.set(id, new LiveObject<Stay>(stay));
    }
  }
  return stays;
}

/** Starts a fresh search for a leg, dropping its old options, votes and pick. Null for a leg being booked. */
function reset(storage: Root, legId: string, patch: { date?: string }) {
  const leg = storage.get("legs").get(legId);
  // a settled leg's options are fixed until its booking is cancelled
  if (!leg || leg.get("booking")) return null;
  const search = pending();
  leg.update({ ...patch, search, chosen: null });
  const votes = leg.get("votes");
  for (const who of [...votes.keys()]) votes.delete(who);
  return search.id;
}

function splitEqual(a: Split | null, b: Split | null) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function legsEqual(a: PlanLeg[] | null, b: PlanLeg[] | null) {
  return JSON.stringify(a) === JSON.stringify(b);
}
