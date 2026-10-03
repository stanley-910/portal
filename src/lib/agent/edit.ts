import "server-only";

import { LiveMap, LiveObject } from "@liveblocks/node";

import type { Handles, PlanJson } from "@/lib/agent/snapshot";
import { showDate } from "@/lib/agent/snapshot";
import { liveblocks } from "@/lib/liveblocks/server";
import type { LegSearch, Stay, Stop } from "@/lib/liveblocks/types";
import { searchPlaces } from "@/lib/places/search";
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
  | { op: "set_stay_cost"; stop: string; nightly: { amount: number; currency: string } | null; label?: string | null }
  | { op: "set_leaves"; member: string; date: string | null }
  | { op: "set_trip_end"; date: string | null };

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

export type Refusal = { op: number; code: "AMBIGUOUS_PLACE" | "UNKNOWN_PLACE" | "UNKNOWN_HANDLE" | "BAD_DATE"; reason: string; next: string };

export type EditResult = { applied: string[]; refused: Refusal[]; changesetId: string | null };

const newId = () => crypto.randomUUID().slice(0, 8);
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

/** Applies ops for the agent as one changeset, then starts the searches they need. */
export async function editPlan(roomId: string, plan: PlanJson, h: Handles, ops: EditOp[], agentId: string): Promise<EditResult> {
  const refused: Refusal[] = [];
  const applied: string[] = [];
  const before: Before = { legs: {}, stops: {} };
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
    | { kind: "add"; from: string | Stop; to: string | Stop; date: string; riders: string[] }
    | { kind: "date"; leg: string; date: string }
    | { kind: "riders"; leg: string; riders: string[] }
    | { kind: "remove"; leg: string }
    | { kind: "stay"; stop: string; stay: Stay | null }
    | { kind: "leaves"; member: string; date: string | null }
    | { kind: "ends"; date: string | null };
  const planned: Planned[] = [];
  ops.forEach((op, i) => {
    const refuse = (r: Omit<Refusal, "op">) => refused.push({ op: i, ...r });
    const unknown = (handle: string) => refuse({ code: "UNKNOWN_HANDLE", reason: `${handle} isn't in the trip.`, next: "Call get_trip and use its handles." });
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
    const date = "date" in op ? op.date : null;
    if (date !== null && !DATE.test(date)) {
      return refuse({ code: "BAD_DATE", reason: `${date} isn't YYYY-MM-DD.`, next: "Retry with an ISO date." });
    }
    switch (op.op) {
      case "add_leg": {
        const from = ref(op.from);
        const to = ref(op.to);
        const who = riders(op.riders);
        if (from && to && who) planned.push({ kind: "add", from, to, date: op.date, riders: who });
        return;
      }
      case "set_date": {
        const leg = legId(op.leg);
        if (!leg) return unknown(op.leg);
        planned.push({ kind: "date", leg, date: op.date });
        return;
      }
      case "set_riders": {
        const leg = legId(op.leg);
        const who = riders(op.riders);
        if (!leg) return unknown(op.leg);
        if (who) planned.push({ kind: "riders", leg, riders: who });
        return;
      }
      case "remove_leg": {
        const leg = legId(op.leg);
        if (!leg) return unknown(op.leg);
        planned.push({ kind: "remove", leg });
        return;
      }
      case "set_stay_cost": {
        const stop = h.id.get(op.stop);
        if (!stop || !plan.stops?.[stop]) return unknown(op.stop);
        if (op.nightly && !(op.nightly.amount >= 0)) {
          return refuse({ code: "BAD_DATE", reason: "A nightly cost can't be negative.", next: "Ask what it costs." });
        }
        // clearing both the price and the label removes the stay
        const label = op.label ?? plan.stays?.[stop]?.label ?? null;
        planned.push({ kind: "stay", stop, stay: op.nightly || label ? { nightly: op.nightly, label } : null });
        return;
      }
      case "set_leaves": {
        const who = member(op.member);
        if (!who) return unknown(op.member);
        planned.push({ kind: "leaves", member: who, date: op.date });
        return;
      }
      case "set_trip_end":
        planned.push({ kind: "ends", date: op.date });
        return;
    }
  });

  if (!planned.length) return { applied, refused, changesetId: null };
  const changesetId = newId();
  const created: Record<string, Stop> = {};

  await liveblocks().mutateStorage(roomId, ({ root }) => {
    const stops = root.get("stops");
    const legs = root.get("legs");
    const stopName = (id: string) => created[id]?.name ?? stops.get(id)?.get("name") ?? plan.stops?.[id]?.name ?? "?";
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
      // snap onto a stop already at this hub or point, else make one
      for (const [id, existing] of stops) {
        const e = existing.toJSON();
        if ((s.hub && e.hub === s.hub) || (e.lat === s.lat && e.lng === s.lng)) return id;
      }
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

    for (const p of planned) {
      if (p.kind === "stay") {
        let stays = root.get("stays");
        if (!stays) root.set("stays", (stays = new LiveMap()));
        before.stays ??= {};
        if (!(p.stop in before.stays)) before.stays[p.stop] = plan.stays?.[p.stop] ?? null;
        if (p.stay) stays.set(p.stop, new LiveObject(p.stay));
        else stays.delete(p.stop);
        const where = stopName(p.stop);
        applied.push(
          p.stay?.nightly
            ? `Set ${where}${p.stay.label ? ` (${p.stay.label})` : ""} to ${p.stay.nightly.currency} ${p.stay.nightly.amount} a night`
            : `Cleared the cost of staying in ${where}`,
        );
        continue;
      }
      if (p.kind === "leaves") {
        const m = root.get("members").get(p.member);
        if (!m) continue;
        before.leaves ??= {};
        if (!(p.member in before.leaves)) before.leaves[p.member] = { value: m.get("leaves") ?? null };
        m.set("leaves", p.date);
        const who = m.get("name");
        applied.push(p.date ? `${who} leaves on ${showDate(p.date)}` : `${who} stays to the end`);
        continue;
      }
      if (p.kind === "ends") {
        before.ends ??= { value: root.get("ends") ?? null };
        root.set("ends", p.date);
        applied.push(p.date ? `Trip ends the morning of ${showDate(p.date)}` : "Trip ends after its last leg");
        continue;
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
        continue;
      }
      const leg = legs.get(p.leg);
      if (!leg) continue;
      remember(p.leg);
      const label = `${stopName(leg.get("from"))} → ${stopName(leg.get("to"))}`;
      if (p.kind === "date") {
        // a new date resets the leg's options, votes and pick
        const search = pending();
        leg.update({ date: p.date, search, chosen: null });
        const votes = leg.get("votes");
        for (const who of [...votes.keys()]) votes.delete(who);
        searches.push({ legId: p.leg, searchId: search.id });
        applied.push(`Moved ${label} to ${showDate(p.date)}`);
      } else if (p.kind === "riders") {
        const was = leg.get("riders");
        leg.set("riders", p.riders);
        const name = (id: string) => plan.members?.[id]?.name ?? "someone";
        const off = was.filter((r) => !p.riders.includes(r)).map(name);
        const on = p.riders.filter((r) => !was.includes(r)).map(name);
        applied.push(
          [on.length ? `Put ${names(on)} on ${label}` : "", off.length ? `Took ${names(off)} off ${label}` : ""].filter(Boolean).join("; ") ||
            `No change to who rides ${label}`,
        );
      } else {
        legs.delete(p.leg);
        freed.add(leg.get("from")).add(leg.get("to"));
        applied.push(`Removed ${label}`);
      }
    }

    const used = new Set<string>();
    for (const l of legs.values()) used.add(l.get("from")).add(l.get("to"));
    for (const stop of freed) {
      if (used.has(stop)) continue;
      if (!(stop in before.stops)) before.stops[stop] = stops.get(stop)?.toJSON() ?? null;
      stops.delete(stop);
    }

    const changesets = root.get("changesets");
    if (changesets) changesets.set(changesetId, JSON.stringify(before));
    else root.set("changesets", new LiveMap([[changesetId, JSON.stringify(before)]]));
  });

  // searches run after the write lands, like a member's own edits; they finish on their own
  await Promise.all(searches.map((s) => runLegSearch(roomId, s.legId, s.searchId)));
  return { applied, refused, changesetId };
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
