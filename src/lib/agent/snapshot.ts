import type { ThreadMessage } from "@/lib/agent/types";
import type { MemberInfo, Stop, StoredOffer } from "@/lib/liveblocks/types";

// The plan as the model sees it: short handles (M1, S1, L1) instead of Liveblocks ids, rebuilt from Storage every
// turn so the agent never trusts what it said earlier (harness: "Context: rebuilt every turn").

/** Storage as `getStorageDocument(room, "json")` returns it. */
export type PlanJson = {
  members?: Record<string, MemberInfo>;
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
};

export type Handles = {
  member: Map<string, string>;
  stop: Map<string, string>;
  leg: Map<string, string>;
  /** Handle → id, for all three kinds. */
  id: Map<string, string>;
};

export function handlesFor(plan: PlanJson): Handles {
  const h: Handles = { member: new Map(), stop: new Map(), leg: new Map(), id: new Map() };
  const add = (map: Map<string, string>, prefix: string, ids: string[]) =>
    ids.forEach((id, i) => {
      map.set(id, `${prefix}${i + 1}`);
      h.id.set(`${prefix}${i + 1}`, id);
    });
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
  for (const [id, m] of members) lines.push(`  ${h.member.get(id)} ${m.name}${id === askedBy ? " (asking)" : ""}`);

  const stops = Object.entries(plan.stops ?? {});
  if (stops.length) {
    lines.push("Stops:");
    for (const [id, s] of stops) lines.push(`  ${h.stop.get(id)} ${s.name}${s.code ? ` (${s.code})` : ""}`);
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
  return lines.join("\n");
}

/** The last few messages as plain text. Tool output from earlier turns isn't replayed (harness). */
export function describeThread(plan: PlanJson, h: Handles, limit = 12): string {
  const thread = (plan.thread ?? []).filter((m) => m.state !== "streaming").slice(-limit);
  return thread
    .map((m) => {
      const who = m.author.kind === "agent" ? "Pip" : `${plan.members?.[m.author.id]?.name ?? "Someone"} (${h.member.get(m.author.id) ?? "?"})`;
      const cards = m.cards.map((c) => (c.type === "meetup" ? ` [meet-up card: ${c.options.map((o) => `${o.id} ${o.place.name}`).join(", ")}]` : "")).join("");
      return `${who}: ${m.text}${cards}`;
    })
    .join("\n");
}
