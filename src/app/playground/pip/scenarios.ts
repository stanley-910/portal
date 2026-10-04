import { legMarks, midpoint } from "@/lib/agent/marks";
import type { SoloEvent, SoloLeg } from "@/lib/agent/solo";
import type { Stop } from "@/lib/liveblocks/types";

import { meetup } from "../fixtures";

// Pip's tool calls as scripts: the events /api/pip streams for one reply, in order, each after a wait. Each script
// mirrors what runSolo (lib/agent/solo.ts) emits for that tool, so the lab plays the real saucer and globe without a
// model call.

export type Beat = {
  /** How long after the last event this one comes, at 1×. */
  wait: number;
  event: SoloEvent;
  /** What's happening on the server at this point, for the log. */
  note?: string;
};

export type Scenario = {
  id: string;
  label: string;
  /** The tool this scenario exercises. */
  tool: string;
  /** What the person asks Pip. */
  ask: string;
  /** The legs on the globe before they ask. */
  before: SoloLeg[];
  beats: Beat[];
};

export const STOPS = {
  hkg: { name: "HK West Kowloon", lat: 22.3036, lng: 114.165, hub: null, code: null },
  sha: { name: "Shanghai Hongqiao", lat: 31.196, lng: 121.3161, hub: null, code: null },
  tyo: { name: "Tokyo", lat: 35.6808, lng: 139.7669, hub: null, code: null },
  sel: { name: "Seoul Incheon", lat: 37.4691, lng: 126.451, hub: null, code: null },
} satisfies Record<string, Stop>;

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const words = (text: string, wait = 45): Beat[] => text.split(" ").map((w, i) => ({ wait, event: { t: "text", d: i ? ` ${w}` : w } }));

/**
 * plan_trip, the way runSolo runs it: the model thinks, calls the tool (its step line goes up), the tool replaces the
 * legs on the globe and sends what changed as marks, the step settles, then the model writes its reply.
 */
function planTrip(before: SoloLeg[], after: SoloLeg[], reply: string): Beat[] {
  return [
    { wait: 900, event: { t: "step", id: "c1", label: "Putting it on the globe", done: false, at: 0, globe: true }, note: "model calls plan_trip" },
    { wait: 120, event: { t: "trip", legs: after }, note: "plan_trip replaces the legs on the globe" },
    { wait: 0, event: { t: "marks", marks: legMarks(before, after) }, note: "plan_trip sends what changed, for the saucer to pop" },
    { wait: 40, event: { t: "step", id: "c1", label: "Put it on the globe", done: true, at: 0, globe: true }, note: "tool result back to the model" },
    ...words(reply).map((b, i) => (i ? b : { ...b, wait: 700, note: "model writes its reply" })),
    { wait: 60, event: { t: "done" }, note: "reply ends" },
  ];
}

/**
 * A tool that only looks, the way runSolo runs search_routes, optimize_route and find_meetup: the step goes up, the
 * tool says what it's checking and where (the saucer goes there) while it searches, then lets go, and the model
 * writes its reply.
 */
function look(tool: string, steps: { label: string; at: { lat: number; lng: number }; wait: number }[], done: string, reply: string, card?: Beat): Beat[] {
  return [
    { wait: 900, event: { t: "step", id: "c1", label: "Searching routes", done: false, at: 0, globe: true }, note: `model calls ${tool}` },
    ...steps.map((s, i): Beat => ({ wait: i ? s.wait : 60, event: { t: "activity", label: s.label, at: s.at }, note: i ? undefined : "the tool looks at where it's searching" })),
    { wait: 1200, event: { t: "activity", label: null }, note: "search done" },
    ...(card ? [card] : []),
    { wait: 40, event: { t: "step", id: "c1", label: done, done: true, at: 0, globe: true }, note: "tool result back to the model" },
    ...words(reply).map((b, i) => (i ? b : { ...b, wait: 700, note: "model writes its reply" })),
    { wait: 60, event: { t: "done" }, note: "reply ends" },
  ];
}

const oneLeg: SoloLeg[] = [{ from: STOPS.hkg, to: STOPS.sha, date: day(1) }];
const toSeoul: SoloLeg[] = [
  { from: STOPS.hkg, to: STOPS.sha, date: day(1) },
  { from: STOPS.sha, to: STOPS.sel, date: day(3) },
];
const twoLegs: SoloLeg[] = [
  { from: STOPS.hkg, to: STOPS.sha, date: day(1) },
  { from: STOPS.sha, to: STOPS.tyo, date: day(3) },
];

export const SCENARIOS: Scenario[] = [
  {
    id: "add-one",
    label: "Add a trip",
    tool: "plan_trip",
    ask: "Train from Hong Kong to Shanghai tomorrow",
    before: [],
    beats: planTrip([], oneLeg, "HK West Kowloon → Shanghai Hongqiao is on your globe for tomorrow. The card's searching fares now."),
  },
  {
    // a spotty connection: the reply trickles in and stalls halfway, long after the trip's gone on the globe
    id: "slow",
    label: "Slow connection",
    tool: "plan_trip",
    ask: "Hong Kong to Shanghai tomorrow",
    before: [],
    beats: planTrip([], oneLeg, "HK West Kowloon → Shanghai Hongqiao is on your globe for tomorrow. The card's searching fares now.").map((b) =>
      b.event.t !== "text" ? b : { ...b, wait: b.event.d.includes("globe") ? 2500 : 300 },
    ),
  },
  {
    id: "add-two",
    label: "Add a 2-leg trip",
    tool: "plan_trip",
    ask: "Hong Kong to Shanghai tomorrow, then on to Tokyo two days later",
    before: [],
    beats: planTrip([], twoLegs, "Both legs are on your globe: HK West Kowloon → Shanghai Hongqiao tomorrow, then on to Tokyo two days later. Each leg's card is searching fares."),
  },
  {
    // on the home globe a leg comes off by plan_trip putting the trip down again without it
    id: "remove",
    label: "Remove a leg",
    tool: "plan_trip",
    ask: "Actually, drop Tokyo. Just Hong Kong to Shanghai.",
    before: twoLegs,
    beats: planTrip(twoLegs, oneLeg, "Dropped Shanghai Hongqiao → Tokyo. HK West Kowloon → Shanghai Hongqiao is still on your globe for tomorrow."),
  },
  {
    // a leg that went and one that came in one plan_trip: it reels the old one back, then draws the new one out
    id: "change",
    label: "Change a destination",
    tool: "plan_trip",
    ask: "Make the second stop Seoul instead of Tokyo.",
    before: twoLegs,
    beats: planTrip(twoLegs, toSeoul, "Swapped Tokyo for Seoul: HK West Kowloon → Shanghai Hongqiao tomorrow, then Shanghai Hongqiao → Seoul Incheon two days later."),
  },
  {
    id: "search",
    label: "Search fares",
    tool: "search_routes",
    ask: "What's cheapest from Hong Kong to Shanghai tomorrow?",
    before: oneLeg,
    beats: look(
      "search_routes",
      [{ label: "checking HK West Kowloon to Shanghai Hongqiao", at: midpoint(STOPS.hkg, STOPS.sha), wait: 0 }],
      "Found 6 routes",
      "The cheapest is the G80 high-speed train at HKD 1,013, 8h 20m; flying is quicker but about twice the price.",
    ),
  },
  {
    id: "meetup",
    label: "Find a meet-up",
    tool: "find_meetup",
    ask: "I'm in Hong Kong, my friend's in Seoul. Where should we meet?",
    before: [],
    beats: look(
      "find_meetup",
      [
        { label: "comparing meet-ups for 2 groups", at: STOPS.hkg, wait: 0 },
        { label: "checking Shanghai", at: STOPS.sha, wait: 1100 },
        { label: "checking Taipei", at: { lat: 25.0777, lng: 121.233 }, wait: 1100 },
        { label: "checking Tokyo", at: STOPS.tyo, wait: 1100 },
      ],
      "Compared 6 routes",
      "Shanghai is cheapest for both of you in total; Taipei is close behind and quicker for you.",
      { wait: 40, event: { t: "card", card: { type: "meetup", title: "Where to meet · cheapest", options: meetup, applied: null, changesetId: null, undone: false } } },
    ),
  },
];
