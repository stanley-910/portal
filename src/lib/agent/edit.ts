import "server-only";

import { LiveMap, LiveObject } from "@liveblocks/node";

import type { AgentMark } from "@/lib/agent/marks";
import type { Handles, PlanJson } from "@/lib/agent/snapshot";
import { showDate } from "@/lib/agent/snapshot";
import { liveblocks } from "@/lib/liveblocks/server";
import type { LegSearch, Stay, Stop } from "@/lib/liveblocks/types";
import { sharesStop } from "@/lib/trip/stops";
import { searchPlaces } from "@/lib/places/search";
import { clampLeave, legBefore, moveLeg, settle, type DateChanges, type DatePlan } from "@/lib/trip/dates";
import { staysOf, type SplitInput } from "@/lib/trip/split";
import { runLegSearch } from "@/lib/trip/search-leg";

// edit_plan (harness G5): the agent's only way to change the trip. Each run's edits are one changeset that Undo
// puts back. Ops that can't apply come back as refusals naming the next step; the rest still apply.

/** A stop handle, free text, or (from an Apply button) an exact point. */
export type PlaceRef = { stop: string } | { place: string } | { at: Stop };

export type EditOp =
  | { op: "add_leg"; from: PlaceRef; to: PlaceRef; date: string; riders: string[] }
  | { op: "set_date"; leg: string; date: string }
  | { op: "set_riders"; leg: string; riders: string[] }
  | { op: "remove_leg"; leg: string }
  | {
      op: "set_stay";
      /** An existing stay's handle to change; without one, a new stay at `stop`. */
      stay?: string;
      stop?: string;
      check_in?: string;
      check_out?: string;
      guests?: string[];
      nightly?: { amount: number; currency: string } | null;
      label?: string | null;
    }
  | { op: "remove_stay"; stay: string }
  | { op: "set_leaves"; member: string; date: string | null };

/**
 * What a changeset puts back, as JSON. Each id maps to the entry's old value, or null if the run created it.
 * `leaves` and `ends` hold the old value wrapped, so "was unset" and "was null" both restore.
 */
type Before = {
  legs: Record<string, LegJson | null>;
  stops: Record<string, Stop | null>;
  stays?: Record<string, Stay | null>;
  leaves?: Record<string, { value: string | null }>;
  ends?: { value: string | null };
};

export type Refusal = { op: number; code: "AMBIGUOUS_PLACE" | "UNKNOWN_PLACE" | "UNKNOWN_HANDLE" | "BAD_DATE" | "LOCKED" | "OUT_OF_TIME"; reason: string; next: string };

/** `marks` are the same changes, short and placed, for the globe to pop up (marks.ts). */
export type EditResult = { applied: string[]; refused: Refusal[]; changesetId: string | null; marks: AgentMark[] };

const newId = () => crypto.randomUUID().slice(0, 8);

/**
 * One Undo across several `editPlan` calls, as when Pip makes its changes one at a time. The searches they start
 * collect in `searches` rather than hold up the next call.
 */
export type Changeset = { id: string; before: Before; searches: Promise<unknown>[] };
export const newChangeset = (): Changeset => ({ id: newId(), before: { legs: {}, stops: {} }, searches: [] });
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Free text to a stop, from the bundled index only (no geocoding, TR1). */
export function resolvePlace(text: string): { stop: Stop } | { refusal: Omit<Refusal, "op"> } {
  const found = searchPlaces(text, undefined, 6).filter((p) => p.kind !== "country" && p.kind !== "region");
  if (!found.length) {
    return { refusal: { code: "UNKNOWN_PLACE", reason: `No city, airport or station called "${text}" in coverage.`, next: "Ask which city they mean." } };
  }
  const best = found[0];
  // Same name in two countries is a real ambiguity. Shanghai's two airports aren't: searches pick hubs per mode.
  const twins = found.filter((p) => p.kind === best.kind && p.name === best.name && p.detail !== best.detail);
  if (twins.length) {
    const options = [best, ...twins].map((p) => `${p.name}, ${p.detail}`).join(" or ");
    return { refusal: { code: "AMBIGUOUS_PLACE", reason: `"${text}" could be ${options}.`, next: "Retry with the country in the place text." } };
  }
  const hub = best.kind === "airport" || best.kind === "station" ? best.id : null;
  return { stop: { lat: best.lat, lng: best.lng, hub, code: best.code ?? null, name: best.name } };
}

type LegJson = NonNullable<PlanJson["legs"]>[string];

/**
 * Where the first of these ops changes the trip, read before any is applied, so Pip's saucer can get there first: a
 * leg's destination, or a stay's stop. Null when none says (a leave date).
 */
export function editTarget(plan: PlanJson, h: Handles, ops: EditOp[]): { lat: number; lng: number } | null {
  const stop = (id: string | undefined) => (id ? plan.stops?.[id] : undefined);
  const point = (s: { lat: number; lng: number } | undefined) => (s ? { lat: s.lat, lng: s.lng } : null);
  for (const op of ops) {
    let at: { lat: number; lng: number } | null = null;
    if (op.op === "add_leg") {
      const to = op.to;
      if ("at" in to) at = point(to.at);
      else if ("stop" in to) at = point(stop(h.id.get(to.stop)));
      else {
        const r = resolvePlace(to.place);
        at = "stop" in r ? point(r.stop) : null;
      }
    } else if (op.op === "set_date" || op.op === "set_riders" || op.op === "remove_leg") {
      at = point(stop(plan.legs?.[h.id.get(op.leg) ?? ""]?.to));
    } else if (op.op === "set_stay") {
      const stay = op.stay ? staysOf(plan as SplitInput).find((s) => s.id === h.id.get(op.stay!)) : undefined;
      at = point(stop(op.stop ? h.id.get(op.stop) : stay?.stop));
    } else if (op.op === "remove_stay") {
      at = point(stop(staysOf(plan as SplitInput).find((s) => s.id === h.id.get(op.stay))?.stop));
    }
    if (at) return at;
  }
  return null;
}

/**
 * Applies ops for the agent as one changeset, then starts the searches they need. A run passes `until`, when its
 * turn ends: past it the write changes nothing, since the next reply may have started editing. Pass `into` to add
 * them to a changeset earlier calls started, so one Undo puts back all of them.
 */
export async function editPlan(
  roomId: string,
  plan: PlanJson,
  h: Handles,
  ops: EditOp[],
  agentId: string,
  until?: number,
  into?: Changeset,
): Promise<EditResult> {
  const changeset = into ?? newChangeset();
  const refused: Refusal[] = [];
  const applied: string[] = [];
  const marks: AgentMark[] = [];
  const { before } = changeset;
  const searches: { legId: string; searchId: string }[] = [];
  // handles outlive members within a run (snapshot.ts), so check they're still in the trip
  const member = (handle: string) => {
    const id = h.id.get(handle) ?? handle;
    return plan.members?.[id] ? id : undefined;
  };
  const legId = (handle: string) => {
    const id = h.id.get(handle);
    return id && plan.legs?.[id] ? id : undefined;
  };
  // Resolve everything before writing, so a refusal never leaves half an op behind.
  type Planned =
    | { kind: "add"; op: number; from: string | Stop; to: string | Stop; date: string; riders: string[] }
    | { kind: "date"; op: number; leg: string; date: string }
    | { kind: "riders"; op: number; leg: string; riders: string[] }
    | { kind: "remove"; op: number; leg: string }
    | { kind: "stay"; id: string; stay: Stay | null; created: boolean }
    | { kind: "leaves"; member: string; date: string | null };
  const planned: Planned[] = [];
  // every stay whole, older stop-keyed ones included, so a handle always means one stay with dates and guests
  const stays = staysOf(plan as SplitInput);
  const stayFor = (handle: string) => {
    const id = h.id.get(handle);
    return stays.find((s) => s.id === id);
  };
  ops.forEach((op, i) => {
    const refuse = (r: Omit<Refusal, "op">) => refused.push({ op: i, ...r });
    const unknown = (handle: string) => refuse({ code: "UNKNOWN_HANDLE", reason: `${handle} isn't in the trip.`, next: "Call get_trip and use its handles." });
    // a leg being bought keeps its date, riders and place in the trip until a rider cancels the settle
    const locked = (handle: string) => {
      const id = legId(handle);
      if (!id || !plan.legs?.[id]?.booking) return false;
      refuse({ code: "LOCKED", reason: `${handle} is being booked, so it can't change.`, next: "Ask a rider to cancel the settle first." });
      return true;
    };
    const ref = (p: PlaceRef): string | Stop | null => {
      if ("at" in p) return p.at;
      if ("stop" in p) {
        const id = h.id.get(p.stop);
        if (!id || !plan.stops?.[id]) return unknown(p.stop), null;
        return id;
      }
      const r = resolvePlace(p.place);
      if ("refusal" in r) return refuse(r.refusal), null;
      return r.stop;
    };
    const riders = (list: string[]) => {
      const ids = list.map(member);
      const missing = list.filter((_, j) => !ids[j]);
      if (missing.length) return unknown(missing.join(", ")), null;
      return ids as string[];
    };
    const dates = ["date" in op ? op.date : null, "check_in" in op ? op.check_in : null, "check_out" in op ? op.check_out : null];
    const bad = dates.find((d) => d != null && !DATE.test(d));
    if (bad) return refuse({ code: "BAD_DATE", reason: `${bad} isn't YYYY-MM-DD.`, next: "Retry with an ISO date." });
    switch (op.op) {
      case "add_leg": {
        const from = ref(op.from);
        const to = ref(op.to);
        const who = riders(op.riders);
        if (from && to && who) planned.push({ kind: "add", op: i, from, to, date: op.date, riders: who });
        return;
      }
      case "set_date": {
        if (locked(op.leg)) return;
        const leg = legId(op.leg);
        if (!leg) return unknown(op.leg);
        planned.push({ kind: "date", op: i, leg, date: op.date });
        return;
      }
      case "set_riders": {
        if (locked(op.leg)) return;
        const leg = legId(op.leg);
        const who = riders(op.riders);
        if (!leg) return unknown(op.leg);
        if (who) planned.push({ kind: "riders", op: i, leg, riders: who });
        return;
      }
      case "remove_leg": {
        if (locked(op.leg)) return;
        const leg = legId(op.leg);
        if (!leg) return unknown(op.leg);
        planned.push({ kind: "remove", op: i, leg });
        return;
      }
      case "set_stay": {
        const was = op.stay ? stayFor(op.stay) : undefined;
        if (op.stay && !was) return unknown(op.stay);
        const stop = op.stop ? h.id.get(op.stop) : was?.stop;
        if (op.stop && (!stop || !plan.stops?.[stop])) return unknown(op.stop);
        if (!stop) return refuse({ code: "UNKNOWN_HANDLE", reason: "A new stay needs a stop.", next: "Retry with the stop handle it's at." });
        const guests = op.guests ? riders(op.guests) : (was?.guests ?? null);
        if (!guests) return op.guests ? undefined : refuse({ code: "UNKNOWN_HANDLE", reason: "A new stay needs its guests.", next: "Retry with the member handles staying there." });
        const checkIn = op.check_in ?? was?.checkIn;
        const checkOut = op.check_out ?? was?.checkOut;
        if (!checkIn || !checkOut || checkOut <= checkIn) {
          return refuse({ code: "BAD_DATE", reason: "A stay needs a check-in and a later check-out.", next: "Ask which nights they stay." });
        }
        if (op.nightly && !(op.nightly.amount >= 0)) {
          return refuse({ code: "BAD_DATE", reason: "A nightly cost can't be negative.", next: "Ask what it costs." });
        }
        const nightly = op.nightly === undefined ? (was?.nightly ?? null) : op.nightly;
        // a price someone says isn't an estimate; one left as it was keeps what it was
        const estimated = op.nightly === undefined ? (was?.estimated ?? false) : false;
        const stay: Stay = { stop, checkIn, checkOut, guests, nightly, label: op.label === undefined ? (was?.label ?? null) : op.label, estimated, createdAt: was?.createdAt || Date.now() };
        // nobody left in it removes it
        planned.push({ kind: "stay", id: was?.id ?? newId(), stay: guests.length ? stay : null, created: !was });
        return;
      }
      case "remove_stay": {
        const was = stayFor(op.stay);
        if (!was) return unknown(op.stay);
        planned.push({ kind: "stay", id: was.id, stay: null, created: false });
        return;
      }
      case "set_leaves": {
        const who = member(op.member);
        if (!who) return unknown(op.member);
        planned.push({ kind: "leaves", member: who, date: op.date });
        return;
      }
    }
  });

  if (!planned.length) return { applied, refused, changesetId: null, marks };
  const changesetId = changeset.id;
  const created: Record<string, Stop> = {};
  let late = false;

  await liveblocks().mutateStorage(roomId, ({ root }) => {
    // checked against what's stored as it's written, not the run's snapshot
    if (until !== undefined && Date.now() > until) return void (late = true);
    const members = root.get("members");
    const gone = (riders: string[]) => riders.filter((r) => !members.get(r)).map((r) => h.member.get(r) ?? r);
    const stops = root.get("stops");
    const legs = root.get("legs");
    const stopName = (id: string) => created[id]?.name ?? stops.get(id)?.get("name") ?? plan.stops?.[id]?.name ?? "?";
    const stopAt = (id: string) => created[id] ?? stops.get(id)?.toJSON() ?? plan.stops?.[id] ?? null;
    // where a leg's mark goes: the stop it ends at, where its pin drops
    const legAt = (id: string) => {
      const l = legs.get(id);
      const b = l && stopAt(l.get("to"));
      return b ? { lat: b.lat, lng: b.lng } : null;
    };
    const mark = (text: string, at: AgentMark["at"]) => marks.push({ text, at });
    const stopFor = (s: string | Stop) => {
      if (typeof s === "string") {
        // someone removed it since the snapshot: put it back rather than point a leg at nothing
        const was = plan.stops?.[s];
        if (!stops.get(s) && was) {
          stops.set(s, new LiveObject(was));
          before.stops[s] ??= null;
        }
        return s;
      }
      // snap onto a stop already at this place (the same hub, or close by), else make one
      for (const [id, existing] of stops) if (sharesStop(existing.toJSON(), s)) return id;
      const id = newId();
      stops.set(id, new LiveObject(s));
      created[id] = s;
      before.stops[id] = null;
      return id;
    };
    const pending = (): LegSearch => ({ id: newId(), status: "searching", offers: [] });
    const remember = (id: string) => {
      if (!(id in before.legs)) before.legs[id] = plan.legs?.[id] ?? null;
    };
    // stops a removed leg used; they go at the end, once no leg in the trip uses them, so a later op in the same
    // changeset can still add a leg to them
    const freed = new Set<string>();
    const legLabel = (id: string) => {
      const l = legs.get(id);
      return l ? `${stopName(l.get("from"))} → ${stopName(l.get("to"))}` : (h.leg.get(id) ?? "a leg");
    };
    // the dates as stored right now, for `@/lib/trip/dates` to keep in order (same rules as the plan panel)
    const datesNow = (): DatePlan => ({
      legs: Object.fromEntries(
        [...legs.entries()].map(([id, l]) => [id, { date: l.get("date"), riders: l.get("riders"), createdAt: l.get("createdAt"), booking: l.get("booking") ?? null }]),
      ),
      members: Object.fromEntries([...members.entries()].map(([id, m]) => [id, { leaves: m.get("leaves") ?? null }])),
      ends: root.get("ends") ?? null,
    });
    const setLeaves = (id: string, date: string | null) => {
      const m = members.get(id);
      if (!m) return null;
      before.leaves ??= {};
      if (!(id in before.leaves)) before.leaves[id] = { value: m.get("leaves") ?? null };
      m.set("leaves", date);
      return m.get("name");
    };
    const setTripEnd = (date: string | null) => {
      before.ends ??= { value: root.get("ends") ?? null };
      root.set("ends", date);
    };
    /**
     * The stays map, with any older stop-keyed stays written out whole first (`staysOf`), each remembered for Undo, so
     * a handle's stay is the one stored.
     */
    const staysMap = () => {
      let map = root.get("stays");
      if (!map) root.set("stays", (map = new LiveMap()));
      if ([...map.values()].some((s) => !s.get("stop"))) {
        before.stays ??= {};
        for (const [id, s] of [...map.entries()]) {
          if (s.get("stop")) continue;
          if (!(id in before.stays)) before.stays[id] = s.toJSON() as Stay;
          map.delete(id);
        }
        for (const { id, ...stay } of stays) {
          if (map.has(id)) continue;
          if (!(id in before.stays)) before.stays[id] = null;
          map.set(id, new LiveObject<Stay>(stay));
        }
      }
      return map;
    };
    /** Leave dates and the trip's end that other edits pushed along, each said in the changes. */
    const follow = (changes: DateChanges) => {
      for (const [id, date] of Object.entries(changes.leaves)) {
        const who = setLeaves(id, date);
        if (who) applied.push(`${who} now leaves on ${showDate(date)}, to stay within the trip`);
      }
      if (changes.ends !== undefined && changes.ends !== (root.get("ends") ?? null)) {
        setTripEnd(changes.ends);
        if (changes.ends) applied.push(`Trip now ends the morning of ${showDate(changes.ends)}, the day of its last leg`);
      }
    };

    for (const p of planned) {
      if (p.kind === "stay") {
        const map = staysMap();
        before.stays ??= {};
        if (!(p.id in before.stays)) before.stays[p.id] = (map.get(p.id)?.toJSON() as Stay | undefined) ?? null;
        if (p.stay) map.set(p.id, new LiveObject(p.stay));
        else map.delete(p.id);
        const where = stopName(p.stay?.stop ?? stays.find((s) => s.id === p.id)?.stop ?? "");
        const who = p.stay ? names(p.stay.guests!.map((g) => members.get(g)?.get("name") ?? h.member.get(g) ?? "someone")) : "";
        const price = p.stay?.nightly ? `, ${p.stay.nightly.currency} ${p.stay.nightly.amount} a night` : "";
        const at = stopAt(p.stay?.stop ?? stays.find((s) => s.id === p.id)?.stop ?? "");
        mark(!p.stay ? `Removed the stay in ${where}` : `${p.created ? "Added a" : "Set the"} stay in ${where}`, at && { lat: at.lat, lng: at.lng });
        applied.push(
          !p.stay
            ? `Removed the stay in ${where}`
            : `${p.created ? "Added a stay" : "Set the stay"} in ${where}${p.stay.label ? ` (${p.stay.label})` : ""}: ${showDate(p.stay.checkIn!)} to ${showDate(p.stay.checkOut!)} for ${who}${price}`,
        );
        continue;
      }
      if (p.kind === "leaves") {
        // between their first leg and the trip's end
        const date = clampLeave(datesNow(), p.member, p.date);
        const who = setLeaves(p.member, date);
        if (!who) continue;
        const why = !date || !p.date || date === p.date ? "" : date > p.date ? ", the day of their first leg" : ", when the trip ends";
        applied.push(date ? `${who} leaves on ${showDate(date)}${why}` : `${who} stays to the end`);
        // where they are when they go: the end of their last leg before it
        const last = [...legs.values()]
          .filter((l) => l.get("riders").includes(p.member) && (!date || l.get("date") < date))
          .sort((x, y) => x.get("date").localeCompare(y.get("date")))
          .at(-1);
        const there = last ? stopAt(last.get("to")) : null;
        mark(date ? `${who} leaves on ${showDate(date)}` : `${who} stays to the end`, there && { lat: there.lat, lng: there.lng });
        continue;
      }
      if (p.kind === "add" || p.kind === "riders") {
        // someone left the trip since the snapshot
        const left = gone(p.riders);
        if (left.length) {
          refused.push({ op: p.op, code: "UNKNOWN_HANDLE", reason: `${left.join(", ")} isn't in the trip any more.`, next: "Call get_trip and use its handles." });
          continue;
        }
      }
      if (p.kind === "add") {
        const id = newId();
        const search = pending();
        const from = stopFor(p.from);
        const to = stopFor(p.to);
        remember(id);
        legs.set(
          id,
          new LiveObject({
            from, to, date: p.date, createdBy: agentId, riders: p.riders, search,
            votes: new LiveMap<string, string>(), chosen: null, createdAt: Date.now(),
          }),
        );
        searches.push({ legId: id, searchId: search.id });
        applied.push(`Added ${stopName(from)} → ${stopName(to)} on ${showDate(p.date)}`);
        mark(`Added ${stopName(from)} → ${stopName(to)}`, legAt(id));
        continue;
      }
      const leg = legs.get(p.leg);
      if (!leg) continue;
      // a rider started buying it since the snapshot
      if (leg.get("booking")) {
        refused.push({ op: p.op, code: "LOCKED", reason: `${h.leg.get(p.leg) ?? "That leg"} is being booked, so it can't change.`, next: "Ask a rider to cancel the settle first." });
        continue;
      }
      const label = legLabel(p.leg);
      if (p.kind === "date") {
        // no earlier than the leg that gets its riders there; later legs they take move along with it
        const changes = moveLeg(datesNow(), p.leg, p.date);
        if (changes.blocked.length) {
          const fixed = changes.blocked.map(legLabel).join(", ");
          refused.push({ op: p.op, code: "LOCKED", reason: `Moving ${label} to ${showDate(p.date)} would move ${fixed}, which is being booked.`, next: "Pick an earlier date, or ask a rider to cancel the settle first." });
          continue;
        }
        // a new date resets the leg's options, votes and pick
        const redate = (id: string, date: string) => {
          const l = legs.get(id);
          if (!l) return;
          remember(id);
          const search = pending();
          l.update({ date, search, chosen: null });
          const votes = l.get("votes");
          for (const who of [...votes.keys()]) votes.delete(who);
          searches.push({ legId: id, searchId: search.id });
        };
        const prev = changes.date === p.date ? null : legBefore(datesNow(), p.leg);
        redate(p.leg, changes.date);
        applied.push(`Moved ${label} to ${showDate(changes.date)}${prev ? `, the earliest after ${legLabel(prev.leg)}` : ""}`);
        mark(`Moved ${label} to ${showDate(changes.date)}`, legAt(p.leg));
        for (const [id, date] of Object.entries(changes.legs)) {
          if (id === p.leg) continue;
          redate(id, date);
          applied.push(`Moved ${legLabel(id)} to ${showDate(date)} so it still comes after ${label}`);
          mark(`Moved ${legLabel(id)} to ${showDate(date)}`, legAt(id));
        }
        follow(changes);
        continue;
      }
      remember(p.leg);
      if (p.kind === "riders") {
        const was = leg.get("riders");
        leg.set("riders", p.riders);
        const name = (id: string) => plan.members?.[id]?.name ?? "someone";
        const off = was.filter((r) => !p.riders.includes(r)).map(name);
        const on = p.riders.filter((r) => !was.includes(r)).map(name);
        if (on.length) mark(`Put ${names(on)} on ${label}`, legAt(p.leg));
        if (off.length) mark(`Took ${names(off)} off ${label}`, legAt(p.leg));
        applied.push(
          [on.length ? `Put ${names(on)} on ${label}` : "", off.length ? `Took ${names(off)} off ${label}` : ""].filter(Boolean).join("; ") ||
            `No change to who rides ${label}`,
        );
      } else {
        mark(`Removed ${label}`, legAt(p.leg));
        legs.delete(p.leg);
        freed.add(leg.get("from")).add(leg.get("to"));
        applied.push(`Removed ${label}`);
      }
    }

    const used = new Set<string>();
    for (const l of legs.values()) used.add(l.get("from")).add(l.get("to"));
    // a stay keeps its stop, whoever rides there; an older stop-keyed one is keyed by it
    for (const [id, s] of root.get("stays")?.entries() ?? []) used.add(s.get("stop") ?? id);
    for (const stop of freed) {
      if (used.has(stop)) continue;
      if (!(stop in before.stops)) before.stops[stop] = stops.get(stop)?.toJSON() ?? null;
      stops.delete(stop);
    }
    // added, removed and re-ridden legs can leave the trip's end or someone's leave date out of step
    if (applied.length) follow(settle(datesNow()));

    if (!applied.length) return;
    const changesets = root.get("changesets");
    if (changesets) changesets.set(changesetId, JSON.stringify(before));
    else root.set("changesets", new LiveMap([[changesetId, JSON.stringify(before)]]));
  });

  if (late) {
    const reason = "I ran out of time before making that change.";
    return { applied: [], refused: ops.map((_, op) => ({ op, code: "OUT_OF_TIME" as const, reason, next: "Say nothing changed and ask them to send it again." })), changesetId: null, marks: [] };
  }
  // searches run after the write lands, like a member's own edits; they finish on their own
  const started = searches.map((s) => runLegSearch(roomId, s.legId, s.searchId));
  if (into) into.searches.push(...started);
  else await Promise.all(started);
  return { applied, refused, changesetId: applied.length ? changesetId : null, marks };
}

/** Puts back what one changeset changed. Edits people made since to the same legs are overwritten. */
export async function undoChangeset(roomId: string, changesetId: string) {
  const searches: { legId: string; searchId: string }[] = [];
  await liveblocks().mutateStorage(roomId, ({ root }) => {
    const raw = root.get("changesets")?.get(changesetId);
    if (!raw) return;
    const before = JSON.parse(raw) as Before;
    const stops = root.get("stops");
    const legs = root.get("legs");
    for (const [id, stop] of Object.entries(before.stops)) if (stop) stops.set(id, new LiveObject(stop));
    for (const [id, leg] of Object.entries(before.legs)) {
      if (!leg) {
        legs.delete(id);
        continue;
      }
      const searching = leg.search.status === "searching";
      const search = searching ? { id: newId(), status: "searching" as const, offers: [] } : (leg.search as LegSearch);
      legs.set(id, new LiveObject({ ...leg, search, votes: new LiveMap(Object.entries(leg.votes)) }));
      if (searching) searches.push({ legId: id, searchId: search.id });
    }
    // stops the changeset created go once no leg uses them
    const used = new Set<string>();
    for (const l of legs.values()) used.add(l.get("from")).add(l.get("to"));
    for (const [id, stop] of Object.entries(before.stops)) if (!stop && !used.has(id)) stops.delete(id);
    if (before.stays) {
      let stays = root.get("stays");
      if (!stays) root.set("stays", (stays = new LiveMap()));
      for (const [id, stay] of Object.entries(before.stays)) {
        if (stay) stays.set(id, new LiveObject(stay));
        else stays.delete(id);
      }
    }
    for (const [id, { value }] of Object.entries(before.leaves ?? {})) root.get("members").get(id)?.set("leaves", value);
    if (before.ends) root.set("ends", before.ends.value);
    root.get("changesets")?.delete(changesetId);
  });
  await Promise.all(searches.map((s) => runLegSearch(roomId, s.legId, s.searchId)));
}

const names = (list: string[]) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`);
