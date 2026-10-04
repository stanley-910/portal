import type { LatLng } from "@/components/trip-globe";
import type { MeetupOption, ThreadCard, ThreadMessage } from "@/lib/agent/types";
import type { PlanLeg } from "@/lib/trip/plan";
import { computeSplit, staysOf, type SplitInput } from "@/lib/trip/split";

// Made-up data for the playground. Nothing here is read by the app.

export type Persona = { name: string; email: string | null; account: boolean; nationalities: string[]; color: number | null };

export const GUEST: Persona = { name: "Mei", email: null, account: false, nationalities: [], color: null };
export const ACCOUNT: Persona = { name: "Mei Chan", email: "mei@example.com", account: true, nationalities: ["HKG"], color: 2 };

export const PLACES = {
  hkg: { lat: 22.3036, lng: 114.165 },
  sha: { lat: 31.196, lng: 121.3161 },
  sel: { lat: 37.4691, lng: 126.451 },
  tyo: { lat: 35.6808, lng: 139.7669 },
  tpe: { lat: 25.0777, lng: 121.233 },
} satisfies Record<string, LatLng>;

export const PRESETS: { id: string; label: string; stops: LatLng[] | null }[] = [
  { id: "one", label: "HK → Shanghai", stops: [PLACES.hkg, PLACES.sha] },
  { id: "three", label: "3 legs", stops: [PLACES.hkg, PLACES.sha, PLACES.tyo, PLACES.sel] },
  { id: "far", label: "Taipei → Tokyo", stops: [PLACES.tpe, PLACES.tyo] },
  { id: "none", label: "Empty", stops: null },
];

export const MEMBERS = {
  g_mei: { name: "Mei", color: 1 },
  g_ada: { name: "Ada", color: 2 },
  g_joon: { name: "Joon", color: 3 },
  g_sam: { name: "Sam", color: 4 },
};

const DAY = 86_400_000;
export const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

export const meetup: MeetupOption[] = [
  {
    id: "P1",
    place: { name: "Shanghai", code: "SHA", lat: PLACES.sha.lat, lng: PLACES.sha.lng, hub: "train:SHANGHAI-HONGQIAO" },
    date: day(5),
    total: { amount: 412, currency: "USD" },
    estimated: 1,
    legs: [
      { members: ["g_mei", "g_ada"], people: 2, fromStop: null, from: { name: "Hong Kong", lat: PLACES.hkg.lat, lng: PLACES.hkg.lng, hub: null, code: "HKG" }, mode: "train", carrier: "China Railway", durationMin: 500, price: { amount: 92, currency: "USD" }, kind: "timetable" },
      { members: ["g_joon"], people: 1, fromStop: null, from: { name: "Seoul", lat: PLACES.sel.lat, lng: PLACES.sel.lng, hub: null, code: "ICN" }, mode: "flight", carrier: "Korean Air", durationMin: 125, price: { amount: 228, currency: "USD" }, kind: "estimated" },
    ],
  },
  {
    id: "P2",
    place: { name: "Taipei", code: "TPE", lat: PLACES.tpe.lat, lng: PLACES.tpe.lng, hub: "airport:TPE" },
    date: day(6),
    total: { amount: 498, currency: "USD" },
    estimated: 0,
    legs: [
      { members: ["g_mei", "g_ada"], people: 2, fromStop: null, from: { name: "Hong Kong", lat: PLACES.hkg.lat, lng: PLACES.hkg.lng, hub: null, code: "HKG" }, mode: "flight", carrier: "Cathay Pacific", durationMin: 105, price: { amount: 145, currency: "USD" }, kind: "live" },
      { members: ["g_joon"], people: 1, fromStop: null, from: { name: "Seoul", lat: PLACES.sel.lat, lng: PLACES.sel.lng, hub: null, code: "ICN" }, mode: "flight", carrier: "EVA Air", durationMin: 150, price: { amount: 208, currency: "USD" }, kind: "live" },
    ],
  },
];

const t0 = Date.now() - 10 * 60_000;
const msg = (id: string, minutes: number, rest: Omit<ThreadMessage, "id" | "at" | "cards"> & { cards?: ThreadCard[] }): ThreadMessage => ({
  id,
  at: t0 + minutes * 60_000,
  cards: [],
  ...rest,
});

/** One of every kind of message and card Pip's thread shows. */
export const THREAD: ThreadMessage[] = [
  msg("m1", 0, { author: { kind: "member", id: "g_ada" }, text: "I'm in Hong Kong with Mei, Joon's in Seoul. Where should we meet?", state: "done" }),
  msg("m2", 1, {
    author: { kind: "agent" },
    text: "Shanghai is the cheapest middle ground: the high-speed train for you two, a short flight for Joon.",
    state: "done",
    cards: [
      { type: "status", id: "s1", label: "Checked 14 fares", done: true },
      { type: "meetup", title: "Where to meet", options: meetup, applied: null, changesetId: null, undone: false },
    ],
  }),
  msg("m3", 2, { author: { kind: "member", id: "g_mei" }, text: "Add Shanghai, then on to Tokyo together.", state: "done" }),
  msg("m4", 3, {
    author: { kind: "agent" },
    text: "Done. You all fly Shanghai to Tokyo on the 12th.",
    state: "done",
    cards: [{ type: "changes", changesetId: "c1", lines: ["Added Shanghai → Tokyo for everyone", "Moved Joon's flight to the 9th"], undone: false }],
  }),
  msg("m4b", 3, { author: { kind: "member", id: "g_mei" }, text: "Book Shanghai to Tokyo for the three of us.", state: "done" }),
  msg("m4c", 4, { author: { kind: "agent" }, text: "Here's the checkout. Each of you adds your details and holds your share.", state: "done", cards: [{ type: "checkout", legId: "l3" }] }),
  msg("m5", 4, { author: { kind: "member", id: "g_joon" }, text: "Can you check the ferry instead?", state: "done" }),
  msg("m6", 5, { author: { kind: "agent" }, text: "I couldn't reach the ferry timetables just now.", state: "failed" }),
  msg("m7", 6, { author: { kind: "member", id: "g_sam" }, text: "What's the cheapest way home from Tokyo?", state: "done" }),
  msg("m8", 6, { author: { kind: "agent" }, text: "", state: "queued" }),
  msg("m9", 7, {
    author: { kind: "agent" },
    text: "Looking at flights back to Hong Kong",
    state: "streaming",
    cards: [{ type: "status", id: "s2", label: "Checking fares", done: false }],
  }),
];

// A small room for the split: four riders into Shanghai, three on to Tokyo, Ada leaving early.
const stop = (id: string, name: string, code: string, at: LatLng) => ({ id, name, code, hub: null, ...at });
const S = { hkg: stop("hkg", "Hong Kong", "HKG", PLACES.hkg), sel: stop("sel", "Seoul", "ICN", PLACES.sel), sha: stop("sha", "Shanghai", "SHA", PLACES.sha), tyo: stop("tyo", "Tokyo", "TYO", PLACES.tyo) };
const offer = (id: string, amount: number) => ({ id, price: { amount, currency: "USD" }, kind: "estimated" as const });

export const SPLIT_INPUT: SplitInput = {
  members: { g_mei: {}, g_ada: { leaves: day(7) }, g_joon: {}, g_sam: {} },
  legs: {
    l1: { from: "hkg", to: "sha", date: day(5), riders: ["g_mei", "g_ada", "g_sam"], search: { offers: [offer("o1", 92)] }, chosen: "o1", createdAt: 1 },
    l2: { from: "sel", to: "sha", date: day(5), riders: ["g_joon"], search: { offers: [offer("o2", 228)] }, chosen: "o2", createdAt: 2 },
    l3: { from: "sha", to: "tyo", date: day(8), riders: ["g_mei", "g_joon", "g_sam"], search: { offers: [offer("o3", 180)] }, chosen: "o3", createdAt: 3 },
  },
  stays: {
    st1: { stop: "sha", checkIn: day(5), checkOut: day(8), guests: ["g_mei", "g_ada", "g_joon", "g_sam"], nightly: { amount: 180, currency: "USD" }, label: "Bund hotel, 2 rooms", estimated: true },
    st2: { stop: "tyo", checkIn: day(8), checkOut: day(10), guests: ["g_mei", "g_joon", "g_sam"], nightly: { amount: 210, currency: "USD" }, label: "Shinjuku apartment" },
  },
};

export const SPLIT = computeSplit(SPLIT_INPUT);
export const STAYS = staysOf(SPLIT_INPUT);

/** Just what the split reads of each leg: its stops. */
export const SPLIT_LEGS = [
  { id: "l1", from: S.hkg, to: S.sha },
  { id: "l2", from: S.sel, to: S.sha },
  { id: "l3", from: S.sha, to: S.tyo },
] as unknown as PlanLeg[];

/** Pip's reply on the playground, in the stream format /api/pip sends, so the home chat works without a model. */
export function cannedPipReply(): ReadableStream<Uint8Array> {
  const words = "This is the playground, so I'm not really planning anything. Here's what a reply with a meet-up looks like.".split(" ");
  const events: unknown[] = [
    { t: "activity", label: "checking fares", at: PLACES.sha },
    { t: "step", id: "s1", label: "Checking fares", done: false, at: 0 },
    ...words.map((w, i) => ({ t: "text", d: i ? ` ${w}` : w })),
    { t: "step", id: "s1", label: "Checked 14 fares", done: true, at: 0 },
    { t: "card", card: { type: "meetup", title: "Where to meet", options: meetup, applied: null, changesetId: null, undone: false } },
    { t: "activity", label: null },
    { t: "done" },
  ];
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= events.length) return controller.close();
      await new Promise((r) => setTimeout(r, i < 2 ? 500 : 60));
      controller.enqueue(encoder.encode(`${JSON.stringify(events[i++])}\n`));
    },
  });
}
