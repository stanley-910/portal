// Seeds a test trip into the local Liveblocks dev server: four friends, five legs, picks and votes made.
// Run through `pnpm dev:party`, which starts the dev server and passes its URL and keys in. Refuses any other
// Liveblocks, so it can never write into a real project's rooms.
//
// Open http://localhost:3000/t/partyTestRoom001 (or the port next dev prints) and join as a guest.

import { LiveList, LiveMap, LiveObject, toPlainLson } from "@liveblocks/client";
import { Liveblocks } from "@liveblocks/node";

const TRIP_ID = "partyTestRoom001";
const ROOM = `trip:${TRIP_ID}`;

const baseUrl = process.env.LIVEBLOCKS_BASE_URL;
const secret = process.env.LIVEBLOCKS_SECRET_KEY;
if (!baseUrl || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseUrl) || !secret) {
  console.error("seed-party: only seeds the local Liveblocks dev server. Run it with `pnpm dev:party`.");
  process.exit(1);
}

const lb = new Liveblocks({ secret, baseUrl });

// the demo party (src/components/entry/demo-party.ts), as guests; colours in join order
const MEMBERS = {
  g_mei: { name: "Mei", color: 1 },
  g_ada: { name: "Ada", color: 2, leaves: null as string | null },
  g_joon: { name: "Joon", color: 3 },
  g_sam: { name: "Sam", color: 4 },
};

const STOPS = {
  hkg: { lat: 22.3036, lng: 114.165, hub: "train:HK-WEST-KOWLOON", code: "HKG", name: "Hong Kong" },
  icn: { lat: 37.469101, lng: 126.450996, hub: "airport:ICN", code: "ICN", name: "Seoul" },
  tpe: { lat: 25.0777, lng: 121.233002, hub: "airport:TPE", code: "TPE", name: "Taipei" },
  sha: { lat: 31.196, lng: 121.3161, hub: "train:SHANGHAI-HONGQIAO", code: "SHA", name: "Shanghai" },
  tyo: { lat: 35.6808, lng: 139.7669, hub: "train:TOKYO", code: "TYO", name: "Tokyo" },
  osa: { lat: 34.7336, lng: 135.5, hub: "train:SHIN-OSAKA", code: "OSA", name: "Osaka" },
};

const DAY = 86_400_000;
const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const at = (n: number, hhmm: string) => `${day(n)}T${hhmm}:00`;

type Mode = "flight" | "train" | "bus" | "ferry";
const offer = (id: string, mode: Mode, provider: string, carrier: string, d: number, from: string, to: string, min: number, amount: number, currency: string) => ({
  id,
  provider,
  mode,
  kind: "estimated" as const,
  price: { amount, currency },
  carrier,
  depart: at(d, from),
  arrive: at(d, to),
  durationMin: min,
  stops: 0,
  bookingUrl: null,
  attribution: "Seeded test data",
});

const LEGS = [
  {
    id: "leg_hk_sh",
    from: "hkg",
    to: "sha",
    date: day(14),
    riders: ["g_mei", "g_ada"],
    offers: [
      offer("g1", "train", "china-rail", "G80", 14, "08:05", "16:12", 487, 1025, "CNY"),
      offer("g2", "train", "china-rail", "G100", 14, "10:20", "18:41", 501, 1025, "CNY"),
    ],
    chosen: "g1",
    votes: { g_mei: "g1", g_ada: "g1" },
  },
  {
    id: "leg_se_sh",
    from: "icn",
    to: "sha",
    date: day(14),
    riders: ["g_joon"],
    offers: [
      offer("ke", "flight", "travelpayouts", "Korean Air", 14, "09:40", "10:55", 135, 312000, "KRW"),
      offer("mu", "flight", "travelpayouts", "China Eastern", 14, "13:15", "14:25", 130, 268000, "KRW"),
    ],
    chosen: null,
    votes: { g_joon: "mu" },
  },
  {
    id: "leg_sh_ty",
    from: "sha",
    to: "tyo",
    date: day(17),
    riders: ["g_mei", "g_ada", "g_joon"],
    offers: [
      offer("nh", "flight", "travelpayouts", "ANA", 17, "11:30", "15:20", 170, 2380, "CNY"),
      offer("9c", "flight", "travelpayouts", "Spring Airlines", 17, "07:55", "11:50", 175, 1290, "CNY"),
    ],
    chosen: "9c",
    votes: { g_mei: "9c", g_joon: "9c", g_ada: "nh" },
  },
  {
    id: "leg_tp_ty",
    from: "tpe",
    to: "tyo",
    date: day(17),
    riders: ["g_sam"],
    offers: [offer("br", "flight", "travelpayouts", "EVA Air", 17, "08:50", "13:05", 195, 412, "USD")],
    chosen: "br",
    votes: {},
  },
  {
    id: "leg_ty_os",
    from: "tyo",
    to: "osa",
    date: day(20),
    riders: ["g_mei", "g_joon", "g_sam"],
    offers: [
      offer("nz", "train", "gtfs", "Nozomi 21", 20, "09:00", "11:27", 147, 14720, "JPY"),
      offer("hk", "train", "gtfs", "Hikari 507", 20, "09:33", "12:26", 173, 14400, "JPY"),
    ],
    chosen: null,
    votes: { g_sam: "nz", g_mei: "nz" },
  },
];

// Ada heads home from Tokyo before the others go on to Osaka
MEMBERS.g_ada.leaves = day(20);

const now = Date.now();
const root = new LiveObject({
  members: new LiveMap(Object.entries(MEMBERS).map(([id, m]) => [id, new LiveObject(m)])),
  stops: new LiveMap(Object.entries(STOPS).map(([id, s]) => [id, new LiveObject(s)])),
  legs: new LiveMap(
    LEGS.map((leg, i) => [
      leg.id,
      new LiveObject({
        from: leg.from,
        to: leg.to,
        date: leg.date,
        createdBy: leg.riders[0],
        riders: leg.riders,
        search: { id: `s_${leg.id}`, status: "done", offers: leg.offers },
        votes: new LiveMap(Object.entries(leg.votes)),
        chosen: leg.chosen,
        createdAt: now + i,
      }),
    ]),
  ),
  stays: new LiveMap([
    // each stay has its own guests and nights, apart from who rides there; nobody has one in Osaka yet
    ["st_sha", new LiveObject({ stop: "sha", checkIn: day(14), checkOut: day(17), guests: ["g_mei", "g_ada", "g_joon"], label: "Jing'an apartment", nightly: { amount: 980, currency: "CNY" }, estimated: true, createdAt: 1 })],
    ["st_tyo", new LiveObject({ stop: "tyo", checkIn: day(17), checkOut: day(20), guests: ["g_mei", "g_ada", "g_joon", "g_sam"], label: "Asakusa guesthouse", nightly: { amount: 32000, currency: "JPY" }, estimated: true, createdAt: 2 })],
  ]),
  // made with the room, so posts to Pip never race to create it (src/lib/agent/run.ts)
  thread: new LiveList([]),
});

// a fresh party every run: drop what an earlier run left in a persisted dev server
await lb.deleteRoom(ROOM).catch(() => {});
await lb.createRoom(ROOM, {
  defaultAccesses: [],
  usersAccesses: Object.fromEntries(Object.keys(MEMBERS).map((id) => [id, ["room:write"]])),
  metadata: { members: Object.keys(MEMBERS), title: "Hong Kong, Seoul and Taipei to Osaka", updatedAt: new Date(now).toISOString() },
});
await lb.initializeStorageDocument(ROOM, toPlainLson(root) as Parameters<typeof lb.initializeStorageDocument>[1]);
console.log(`seed-party: trip ready at /t/${TRIP_ID}`);
