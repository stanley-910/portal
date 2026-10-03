import type { ThreadMessage } from "@/lib/agent/types";
import type { LegBooking, Stay, Stop, StoredOffer, TripMember } from "@/lib/liveblocks/types";
import { staysOf, type SplitInput } from "@/lib/trip/split";
import { approx } from "@/lib/transport/fx";
import { KIND } from "@/lib/agent/kind";

// The plan as the model sees it: short handles (M1, S1, L1, H1) instead of Liveblocks ids, rebuilt from Storage every
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
      booking?: LegBooking | null;
      bookingNotice?: string | null;
    }
  >;
  thread?: ThreadMessage[];
  /** Stay id → where some of the group sleep. Read through `staysOf`, which also reads older rooms' stop-keyed ones. */
  stays?: Record<string, Stay>;
  /** Only older rooms' stop-keyed stays read it. */
  ends?: string | null;
};

export type Handles = {
  member: Map<string, string>;
  stop: Map<string, string>;
  leg: Map<string, string>;
  stay: Map<string, string>;
  /** Handle → id, for every kind. */
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
    stay: new Map(prev?.stay),
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
  add(h.stay, "H", staysOf(plan as SplitInput).map((s) => s.id));
  return h;
}

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const showDate = (iso: string) => DAY.format(new Date(`${iso}T00:00:00Z`));

export function describePlan(plan: PlanJson, h: Handles, today: string, askedBy: string | null): string {
  const lines = [`Today ${today} (${showDate(today)}).`];
  const members = Object.entries(plan.members ?? {});
  const legs = Object.entries(plan.legs ?? {}).sort(([, a], [, b]) => a.createdAt - b.createdAt);
  lines.push(members.length ? "Members:" : "Members: none yet.");
  for (const [id, m] of members) {
    const passports = m.nationalities?.length ? ` · passports ${m.nationalities.join(", ")}` : " · passports not provided";
    // where someone starts is where their first leg leaves from; with no legs, nobody knows yet
    const first = legs.filter(([, l]) => l.riders.includes(id)).sort(([, a], [, b]) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)[0]?.[1];
    const start = first ? ` · starts at ${h.stop.get(first.from)} ${plan.stops?.[first.from]?.name ?? "?"}` : " · start unknown";
    lines.push(`  ${h.member.get(id)} ${m.name}${id === askedBy ? " (asking)" : ""}${start}${passports}${m.leaves ? ` · leaves ${showDate(m.leaves)}` : ""}`);
  }

  const stops = Object.entries(plan.stops ?? {});
  if (stops.length) {
    lines.push("Stops:");
    for (const [id, s] of stops) lines.push(`  ${h.stop.get(id)} ${s.name}${s.code ? ` (${s.code})` : ""}`);
  }

  lines.push(legs.length ? "Legs:" : "Legs: none yet.");
  for (const [id, leg] of legs) {
    const riders = leg.riders.map((r) => h.member.get(r) ?? "?").join(" ") || "nobody";
    const chosen = leg.search.offers.find((o) => o.id === leg.chosen);
    const search =
      leg.search.status === "searching"
        ? "searching"
        : leg.search.status === "failed"
          ? "search failed"
          : `${leg.search.offers.length} options${cheapestOf(leg.search.offers)}${chosen ? `, chosen ${`${chosen.mode} ${chosen.carrier ?? ""}`.trimEnd()}${chosen.kind === "estimated" ? "" : ` arriving ${chosen.arrive.slice(0, 16).replace("T", " ")}`}` : ""}`;
    lines.push(
      `  ${h.leg.get(id)} ${h.stop.get(leg.from)}→${h.stop.get(leg.to)} ${leg.date} (${showDate(leg.date)}) · riders ${riders} · ${search}${describeBooking(leg.booking, h)}`,
    );
  }

  // apart from the legs: riding somewhere never puts anyone in a stay
  const stays = staysOf(plan as SplitInput);
  lines.push(stays.length ? "Stays:" : "Stays: none yet.");
  for (const s of stays) {
    const guests = s.guests.map((g) => h.member.get(g) ?? "?").join(" ") || "nobody";
    const cost = s.nightly ? `${s.nightly.currency} ${s.nightly.amount} a night${s.estimated ? " estimated" : ""}` : "no price";
    lines.push(
      `  ${h.stay.get(s.id)} ${h.stop.get(s.stop) ?? "?"}${s.label ? ` ${s.label}` : ""} · ${showDate(s.checkIn)} to ${showDate(s.checkOut)} · guests ${guests} · ${cost}`,
    );
  }
  return lines.join("\n");
}

/** ", cheapest CNY 973 (timetable fare)": enough to judge a fare question before calling a tool. */
function cheapestOf(offers: readonly StoredOffer[]): string {
  let best: StoredOffer | null = null, bestUsd = Infinity;
  for (const o of offers) {
    const usd = o.price ? approx(o.price.amount, o.price.currency, "USD") : null;
    if (usd !== null && usd < bestUsd) { best = o; bestUsd = usd; }
  }
  return best?.price ? `, cheapest ${best.price.currency} ${Math.round(best.price.amount)} (${KIND[best.kind]})` : ", no prices yet";
}

/** " · booking: group, 2 of 4 paid, deadline Sat 5 Oct" or "", so Pip can say who still owes without touching money. */
function describeBooking(b: LegBooking | null | undefined, h: Handles): string {
  if (!b) return "";
  const seats = Object.entries(b.seats);
  const paid = seats.filter(([, s]) => s.paid).length;
  const owing = seats.filter(([, s]) => !s.paid).map(([id]) => h.member.get(id) ?? "?");
  const money = `${b.total.currency} ${b.total.amount}`;
  if (b.status === "booked") return ` · booked ${money}${b.reference ? ` ref ${b.reference}` : ""}`;
  const stage = b.status === "details" ? `waiting for details from ${seats.filter(([, s]) => !s.details).map(([id]) => h.member.get(id) ?? "?").join(" ") || "nobody"}` : `${paid} of ${seats.length} paid${owing.length ? `, owing ${owing.join(" ")}` : ""}`;
  const due = b.deadline ? `, deadline ${showDate(b.deadline.slice(0, 10))}` : "";
  return ` · booking ${b.mode} ${money}: ${stage}${due}`;
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
