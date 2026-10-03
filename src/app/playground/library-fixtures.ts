import type { LibraryLeg, LibraryMember, LibraryStop, LibraryTrip } from "@/lib/trip/library";
import type { Mode } from "@/lib/transport/types";

// Made-up trips for the Library scene, as `LibraryTrip`s like the server's `listMyLibrary` hands the home globe: a
// signed-in person's saved trips, solo and group, upcoming and past. Nothing here is read from or written to Supabase
// or Liveblocks. "You" are Mei, in colour slot 1 (member-2), as the playground's signed-in persona.

const stop = (code: string, name: string, country: string, lat: number, lng: number): LibraryStop => ({ id: code.toLowerCase(), name, code, country, lat, lng });

export const STOPS = {
  HKG: stop("HKG", "Hong Kong", "HK", 22.3, 114.17),
  SHA: stop("SHA", "Shanghai", "CN", 31.2, 121.32),
  ICN: stop("ICN", "Seoul", "KR", 37.47, 126.45),
  TYO: stop("TYO", "Tokyo", "JP", 35.68, 139.77),
  OSA: stop("OSA", "Osaka", "JP", 34.73, 135.5),
  TPE: stop("TPE", "Taipei", "TW", 25.08, 121.23),
  BKK: stop("BKK", "Bangkok", "TH", 13.69, 100.75),
  SIN: stop("SIN", "Singapore", "SG", 1.36, 103.99),
  MNL: stop("MNL", "Manila", "PH", 14.51, 121.02),
  HAN: stop("HAN", "Hanoi", "VN", 21.22, 105.81),
  KUL: stop("KUL", "Kuala Lumpur", "MY", 2.75, 101.71),
} satisfies Record<string, LibraryStop>;

type StopCode = keyof typeof STOPS;

// the trips written short: stop codes, and `by` left out where the only rider drew the leg
type Leg = { id: string; from: StopCode; to: StopCode; mode: Mode; date: string; riders: string[]; by?: string | null };
type Member = Omit<LibraryMember, "you"> & { you?: boolean };
type Trip = { id: string; title: string; members: Member[]; legs: Leg[]; share: number };

const you = (present = true): Member => ({ id: "mei", name: "Mei", slot: 1, present, you: true });

const TRIPS: Trip[] = [
  {
    id: "sha-meet",
    title: "Shanghai meet-up",
    members: [you(), { id: "kit", name: "Kit", slot: 0, present: true }, { id: "joon", name: "Joon", slot: 2, present: false }],
    legs: [
      { id: "a", from: "HKG", to: "SHA", mode: "train", date: "2026-10-16", riders: ["mei", "kit"], by: "kit" },
      { id: "b", from: "ICN", to: "SHA", mode: "flight", date: "2026-10-16", riders: ["joon"] },
      { id: "c", from: "SHA", to: "TYO", mode: "flight", date: "2026-10-19", riders: ["mei", "kit", "joon"], by: "mei" },
      { id: "d", from: "TYO", to: "ICN", mode: "flight", date: "2026-10-21", riders: ["joon"] },
      { id: "e", from: "TYO", to: "HKG", mode: "flight", date: "2026-10-23", riders: ["mei", "kit"], by: "mei" },
    ],
    share: 4820,
  },
  {
    id: "osaka",
    title: "Osaka and Tokyo",
    members: [you(false)],
    legs: [
      { id: "a", from: "HKG", to: "OSA", mode: "flight", date: "2026-11-07", riders: ["mei"] },
      { id: "b", from: "OSA", to: "TYO", mode: "train", date: "2026-11-10", riders: ["mei"] },
      { id: "c", from: "TYO", to: "HKG", mode: "flight", date: "2026-11-13", riders: ["mei"] },
    ],
    share: 5360,
  },
  {
    id: "bkk-sin",
    title: "Bangkok to Singapore",
    members: [
      you(false),
      { id: "ana", name: "Ana", slot: 3, present: true },
      { id: "lucas", name: "Lucas", slot: 4, present: false },
      { id: "priya", name: "Priya", slot: 5, present: true },
    ],
    legs: [
      { id: "a", from: "HKG", to: "BKK", mode: "flight", date: "2026-11-26", riders: ["mei", "ana", "lucas"], by: "ana" },
      { id: "b", from: "SIN", to: "BKK", mode: "flight", date: "2026-11-27", riders: ["priya"] },
      { id: "c", from: "BKK", to: "KUL", mode: "train", date: "2026-11-30", riders: ["mei", "ana", "lucas", "priya"], by: null },
      { id: "d", from: "KUL", to: "SIN", mode: "bus", date: "2026-12-02", riders: ["mei", "ana", "lucas", "priya"], by: "priya" },
      { id: "e", from: "SIN", to: "HKG", mode: "flight", date: "2026-12-05", riders: ["mei", "ana", "lucas"], by: "mei" },
    ],
    share: 3910,
  },
  {
    id: "manila",
    title: "Manila wedding",
    members: [you(false), { id: "kit", name: "Kit", slot: 0, present: false }],
    legs: [
      { id: "a", from: "HKG", to: "MNL", mode: "flight", date: "2026-12-18", riders: ["mei", "kit"], by: "kit" },
      { id: "b", from: "MNL", to: "HKG", mode: "flight", date: "2026-12-21", riders: ["mei", "kit"], by: "kit" },
    ],
    share: 1740,
  },
  {
    id: "rail-south",
    title: "Down the peninsula",
    members: [you(false)],
    legs: [
      { id: "a", from: "HKG", to: "SIN", mode: "flight", date: "2027-01-08", riders: ["mei"] },
      { id: "b", from: "SIN", to: "KUL", mode: "bus", date: "2027-01-10", riders: ["mei"] },
      { id: "c", from: "KUL", to: "BKK", mode: "train", date: "2027-01-12", riders: ["mei"] },
      { id: "d", from: "BKK", to: "HKG", mode: "flight", date: "2027-01-16", riders: ["mei"] },
    ],
    share: 3280,
  },
  {
    id: "taipei",
    title: "Taipei weekend",
    members: [you(false)],
    legs: [
      { id: "a", from: "HKG", to: "TPE", mode: "flight", date: "2026-09-12", riders: ["mei"] },
      { id: "b", from: "TPE", to: "HKG", mode: "flight", date: "2026-09-14", riders: ["mei"] },
    ],
    share: 1980,
  },
  {
    id: "seoul",
    title: "Seoul by sea",
    members: [
      you(false),
      { id: "joon", name: "Joon", slot: 2, present: false },
      { id: "kit", name: "Kit", slot: 0, present: false },
    ],
    legs: [
      { id: "a", from: "HKG", to: "SHA", mode: "flight", date: "2026-08-02", riders: ["mei", "kit"], by: "mei" },
      { id: "b", from: "SHA", to: "ICN", mode: "ferry", date: "2026-08-04", riders: ["mei", "kit"], by: "kit" },
      { id: "c", from: "ICN", to: "TYO", mode: "flight", date: "2026-08-09", riders: ["mei", "kit", "joon"], by: "joon" },
      { id: "d", from: "TYO", to: "HKG", mode: "flight", date: "2026-08-12", riders: ["mei", "kit"], by: "mei" },
    ],
    share: 4410,
  },
  {
    id: "hanoi",
    title: "Hanoi in the rain",
    members: [you(false), { id: "ana", name: "Ana", slot: 3, present: false }],
    legs: [
      { id: "a", from: "HKG", to: "HAN", mode: "flight", date: "2026-06-20", riders: ["mei", "ana"], by: "ana" },
      { id: "b", from: "HAN", to: "HKG", mode: "flight", date: "2026-06-24", riders: ["mei", "ana"], by: "ana" },
    ],
    share: 1520,
  },
];

const legOf = (l: Leg): LibraryLeg => ({
  id: l.id,
  from: STOPS[l.from],
  to: STOPS[l.to],
  mode: l.mode,
  date: l.date,
  riders: l.riders,
  by: l.by === undefined ? (l.riders.length === 1 ? l.riders[0] : null) : l.by,
});

export const LIB_TRIPS: LibraryTrip[] = TRIPS.map((t, i) => ({
  id: t.id,
  title: t.title,
  owner: i % 3 !== 2,
  updatedAt: "2026-10-01T09:00:00Z",
  members: t.members.map((m) => ({ ...m, you: !!m.you })),
  legs: [...t.legs].sort((a, b) => a.date.localeCompare(b.date)).map(legOf),
  share: { HKD: t.share },
}));

/** The playground's "today", so Upcoming and Past don't drift as real days pass. */
export const LIB_TODAY = "2026-10-04";
