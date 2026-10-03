import type { ThreadMessage } from "@/lib/agent/types";
import type { Stay, Stop, StoredOffer, TripMember } from "@/lib/liveblocks/types";

// The plan as the model sees it: short handles (M1, S1, L1) instead of Liveblocks ids, rebuilt from Storage every
// turn so the agent never trusts what it said earlier (harness: "Context: rebuilt every turn").

/** Storage as `getStorageDocument(room, "json")` returns it. */
export type PlanJson = {
  members?: Record<string, TripMember>;
  stops?: Record<string, Stop>;
  legs?: Record<
    string,
    {
      from: string;
      to: string;
      date: string;
      createdBy: string;
      riders: string[];
      search: { id: string; status: string; offers: StoredOffer[] };
      votes: Record<string, string>;
      chosen: string | null;
      createdAt: number;
    }
  >;
  thread?: ThreadMessage[];
  /** Stop id → what staying there costs the group a night. */
  stays?: Record<string, Stay>;
  /** The morning after the trip's last night. */
  ends?: string | null;
};

export type Handles = {
  member: Map<string, string>;
  stop: Map<string, string>;
  leg: Map<string, string>;
  /** Handle → id, for all three kinds. */
  id: Map<string, string>;
};

/**
 * Short handles for the plan. Pass the handles from earlier in the same run so ones the model already holds keep
 * meaning the same thing: new entries get the next number, and a removed entry's handle is never reused.
 */
export function handlesFor(plan: PlanJson, prev?: Handles): Handles {
  const h: Handles = {
    member: new Map(prev?.member),
    stop: new Map(prev?.stop),
    leg: new Map(prev?.leg),
    id: new Map(prev?.id),
  };
  const add = (map: Map<string, string>, prefix: string, ids: string[]) => {
    let n = map.size;
    for (const id of ids) {
      if (map.has(id)) continue;
      n++;
      map.set(id, `${prefix}${n}`);
      h.id.set(`${prefix}${n}`, id);
    }
  };
  add(h.member, "M", Object.keys(plan.members ?? {}));
  add(h.stop, "S", Object.keys(plan.stops ?? {}));
  add(
    h.leg,
    "L",
    Object.entries(plan.legs ?? {})
      .sort(([, a], [, b]) => a.createdAt - b.createdAt)
      .map(([id]) => id),
  );
  return h;
}

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const showDate = (iso: string) => DAY.format(new Date(`${iso}T00:00:00Z`));

export function describePlan(plan: PlanJson, h: Handles, today: string, askedBy: string | null): string {
  const lines = [`Today ${today} (${showDate(today)}).`];
  const members = Object.entries(plan.members ?? {});
  lines.push(members.length ? "Members:" : "Members: none yet.");
  for (const [id, m] of members) {
    const passports = m.nationalities?.length ? ` · passports ${m.nationalities.join(", ")}` : " · passports not provided";
    lines.push(`  ${h.member.get(id)} ${m.name}${id === askedBy ? " (asking)" : ""}${passports}${m.leaves ? ` · leaves ${showDate(m.leaves)}` : ""}`);
  }

  const stops = Object.entries(plan.stops ?? {});
  if (stops.length) {
    lines.push("Stops:");
    for (const [id, s] of stops) {
      const stay = plan.stays?.[id];
      const cost = stay?.nightly ? ` · stay ${stay.nightly.currency} ${stay.nightly.amount} a night${stay.estimated ? " estimated" : ""}${stay.label ? ` (${stay.label})` : ""}` : "";
      lines.push(`  ${h.stop.get(id)} ${s.name}${s.code ? ` (${s.code})` : ""}${cost}`);
    }
  }

  const legs = Object.entries(plan.legs ?? {}).sort(([, a], [, b]) => a.createdAt - b.createdAt);
  lines.push(legs.length ? "Legs:" : "Legs: none yet.");
  for (const [id, leg] of legs) {
    const riders = leg.riders.map((r) => h.member.get(r) ?? "?").join(" ") || "nobody";
    const chosen = leg.search.offers.find((o) => o.id === leg.chosen);
    const search =
      leg.search.status === "searching"
        ? "searching"
        : leg.search.status === "failed"
          ? "search failed"
          : `${leg.search.offers.length} options${chosen ? `, chosen ${chosen.mode} ${chosen.carrier ?? ""}`.trimEnd() : ""}`;
    lines.push(
      `  ${h.leg.get(id)} ${h.stop.get(leg.from)}→${h.stop.get(leg.to)} ${leg.date} (${showDate(leg.date)}) · riders ${riders} · ${search}`,
    );
  }
  if (plan.ends) lines.push(`Trip ends the morning of ${showDate(plan.ends)}.`);
  return lines.join("\n");
}

/** The last few messages as plain text. Tool output from earlier turns isn't replayed (harness). */
export function describeThread(plan: PlanJson, h: Handles, limit = 12): string {
  const thread = (plan.thread ?? []).filter((m) => m.state !== "streaming" && m.state !== "queued").slice(-limit);
  return thread
    .map((m) => {
      const who = m.author.kind === "agent" ? "Pip" : `${plan.members?.[m.author.id]?.name ?? "Someone"} (${h.member.get(m.author.id) ?? "?"})`;
      const cards = m.cards.map((c) =>
        c.type === "meetup"
          ? ` [meet-up card: ${c.options.map((o) => `${o.id} ${o.place.name}`).join(", ")}]`
          : c.type === "changes"
            ? ` [changed the trip${c.undone ? ", since undone" : ""}: ${c.lines.join("; ")}]`
            : "",
      ).join("");
      return `${who}: ${m.text}${cards}`;
    })
    .join("\n");
}
