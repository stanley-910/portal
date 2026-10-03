import type { Stay, StoredOffer, TripMember } from "@/lib/liveblocks/types";

// Who pays for what. Pure: takes the room's Storage as JSON, so the UI and Pip read the same numbers.
// Presence is derived from legs and leave dates, never stored, so moving a leg moves its nights too.

export type Money = { amount: number; currency: string };

/** Just the Storage the split reads. `getStorageDocument(room, "json")` and the agent's `PlanJson` both fit. */
export type SplitInput = {
  members?: Record<string, Pick<TripMember, "leaves">>;
  legs?: Record<
    string,
    {
      from: string;
      to: string;
      date: string;
      riders: string[];
      search: { offers: Pick<StoredOffer, "id" | "price" | "kind">[] };
      chosen: string | null;
      createdAt: number;
    }
  >;
  stays?: Record<string, Stay>;
  ends?: string | null;
};

export type SplitNight = {
  stop: string;
  /** The night of this date: check in that day, out the next morning. */
  date: string;
  /** Member ids sleeping there that night. */
  present: string[];
  /** The group's cost for the night, or null if nobody has priced the stop. */
  nightly: Money | null;
};

export type MemberSplit = {
  /** One per leg they ride. Null price means the leg has no chosen option yet. */
  fares: { leg: string; price: Money | null; kind: StoredOffer["kind"] | null }[];
  nightShares: { stop: string; date: string; share: Money }[];
  /** Currency → amount. Never converted, since offers mix currencies. */
  totals: Record<string, number>;
  missing: ("no_chosen_offer" | "no_stay_cost")[];
};

export type Split = {
  /** The morning after the last night, or null with no legs. */
  ends: string | null;
  nights: SplitNight[];
  members: Record<string, MemberSplit>;
};

const DAY_MS = 86_400_000;
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
const round = (n: number) => Math.round(n * 100) / 100;
const minDate = (...dates: (string | null | undefined)[]) =>
  dates.filter((d): d is string => !!d).reduce<string | null>((a, b) => (a === null || b < a ? b : a), null);

export function computeSplit(plan: SplitInput): Split {
  const legs = Object.entries(plan.legs ?? {}).sort(([, a], [, b]) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const members = plan.members ?? {};

  const latestLeg = legs.map(([, l]) => l.date).sort().at(-1);
  const latestLeave = Object.values(members).map((m) => m.leaves).filter((d): d is string => !!d).sort().at(-1);
  // A final leg arrives on its travel date, so the default trip end is the following morning.
  // An explicit leave date still wins and excludes that member's leave-day night.
  const ends = plan.ends ?? latestLeave ?? (latestLeg ? nextDay(latestLeg) : null);

  const ids = new Set(Object.keys(members));
  for (const [, leg] of legs) for (const r of leg.riders) ids.add(r);

  const nights = new Map<string, SplitNight>();
  const out: Record<string, MemberSplit> = {};

  for (const id of ids) {
    const mine = legs.filter(([, l]) => l.riders.includes(id));
    const split: MemberSplit = { fares: [], nightShares: [], totals: {}, missing: [] };
    out[id] = split;

    for (const [legId, leg] of mine) {
      const offer = leg.chosen ? leg.search.offers.find((o) => o.id === leg.chosen) : undefined;
      split.fares.push({ leg: legId, price: offer?.price ?? null, kind: offer?.kind ?? null });
    }

    // After each leg they sleep at its destination until their next leg, they leave, or the trip ends.
    // Nobody pays for nights at home, which is where their first leg left from.
    const home = mine[0]?.[1].from;
    mine.forEach(([, leg], i) => {
      if (leg.to === home) return;
      const until = minDate(mine[i + 1]?.[1].date, members[id]?.leaves, ends);
      for (let d = leg.date; until && d < until; d = nextDay(d)) {
        const key = `${leg.to}|${d}`;
        let night = nights.get(key);
        if (!night) {
          night = { stop: leg.to, date: d, present: [], nightly: plan.stays?.[leg.to]?.nightly ?? null };
          nights.set(key, night);
        }
        if (!night.present.includes(id)) night.present.push(id);
      }
    });
  }

  const sorted = [...nights.values()].sort((a, b) => a.date.localeCompare(b.date) || a.stop.localeCompare(b.stop));
  const raw: Record<string, Record<string, number>> = {};
  const add = (id: string, m: Money) => {
    const t = (raw[id] ??= {});
    t[m.currency] = (t[m.currency] ?? 0) + m.amount;
  };

  for (const night of sorted) {
    for (const id of night.present) {
      const split = out[id]!;
      if (!night.nightly) {
        if (!split.missing.includes("no_stay_cost")) split.missing.push("no_stay_cost");
        continue;
      }
      const share = { amount: night.nightly.amount / night.present.length, currency: night.nightly.currency };
      split.nightShares.push({ stop: night.stop, date: night.date, share: { ...share, amount: round(share.amount) } });
      add(id, share);
    }
  }

  for (const [id, split] of Object.entries(out)) {
    for (const fare of split.fares) {
      if (fare.price) add(id, fare.price);
      else if (!split.missing.includes("no_chosen_offer")) split.missing.unshift("no_chosen_offer");
    }
    split.totals = Object.fromEntries(Object.entries(raw[id] ?? {}).map(([c, n]) => [c, round(n)]));
  }

  return { ends, nights: sorted, members: out };
}
