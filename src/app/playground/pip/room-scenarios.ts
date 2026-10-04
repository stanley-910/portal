import type { AgentMark } from "@/lib/agent/marks";
import type { Stop } from "@/lib/liveblocks/types";

import { STOPS } from "./scenarios";

// Pip's tool calls in a trip room, as scripts: what everyone's globe gets from the room while Pip works. Pip's
// presence (what it's doing, and where: the saucer goes there), the plan's legs as they're stored (each drawn as a
// route, with a pin per rider where it ends), and the agent-marks broadcast (the saucer pops each change). Each script
// mirrors what run.ts and tools.ts send for that tool.

export type RoomMember = { name: string; color: number };
/** A stored leg: from and to are stop ids; `by` drew it, and it's in their colour. */
export type RoomLeg = { id: string; from: string; to: string; riders: string[]; by: string };

export type RoomEvent =
  | { t: "presence"; activity: string | null; at?: { lat: number; lng: number } | null }
  | { t: "legs"; legs: RoomLeg[] }
  | { t: "marks"; marks: AgentMark[] }
  | { t: "done" };

export type RoomBeat = { wait: number; event: RoomEvent; note?: string };

export type RoomScript = {
  members: Record<string, RoomMember>;
  stops: Record<string, Stop>;
  /** The legs on the trip before they ask. */
  before: RoomLeg[];
  beats: RoomBeat[];
};

const stops = { hkg: STOPS.hkg, sha: STOPS.sha, tyo: STOPS.tyo, sel: STOPS.sel };
const at = (s: Stop) => ({ lat: s.lat, lng: s.lng });

const direct: RoomLeg[] = [
  { id: "l1", from: "hkg", to: "tyo", riders: ["mei", "ada"], by: "mei" },
  { id: "l2", from: "sel", to: "tyo", riders: ["joon"], by: "joon" },
];

/**
 * plan_group with apply, the way it runs in a room: Pip looks over where they meet while it searches everyone's ways
 * there, then writes the plan in one change (the via legs for Mei and Ada, their direct leg off the trip, Joon's
 * kept) and broadcasts the marks, in the order editPlan made them.
 */
export const PLAN_GROUP: RoomScript = {
  members: { mei: { name: "Mei", color: 2 }, ada: { name: "Ada", color: 3 }, joon: { name: "Joon", color: 4 } },
  stops,
  before: direct,
  beats: [
    { wait: 300, event: { t: "presence", activity: "reading the trip", at: null }, note: "the run starts: Pip's presence says it's working" },
    { wait: 700, event: { t: "presence", activity: "planning everyone's way there", at: at(stops.tyo) }, note: "model calls plan_group; look() at where they meet" },
    { wait: 3500, event: { t: "presence", activity: "putting everyone's routes on the trip", at: at(stops.tyo) }, note: "search done; applying" },
    {
      wait: 150,
      event: {
        t: "legs",
        legs: [
          direct[1],
          { id: "l3", from: "hkg", to: "sha", riders: ["mei", "ada"], by: "mei" },
          { id: "l4", from: "sha", to: "tyo", riders: ["mei", "ada"], by: "mei" },
        ],
      },
      note: "editPlan writes the change to storage",
    },
    {
      wait: 80,
      event: {
        t: "marks",
        marks: [
          { text: "Added HK West Kowloon → Shanghai Hongqiao", at: at(stops.sha), leg: { from: at(stops.hkg), to: at(stops.sha) } },
          { text: "Added Shanghai Hongqiao → Tokyo", at: at(stops.tyo), leg: { from: at(stops.sha), to: at(stops.tyo) } },
          { text: "Removed HK West Kowloon → Tokyo", at: at(stops.hkg), leg: { from: at(stops.hkg), to: at(stops.tyo), gone: true } },
        ],
      },
      note: "agent-marks broadcast",
    },
    { wait: 2200, event: { t: "presence", activity: null, at: null }, note: "reply written; Pip's presence clears" },
    { wait: 0, event: { t: "done" } },
  ],
};

const trip: RoomLeg[] = [
  { id: "l1", from: "hkg", to: "sha", riders: ["mei", "ada"], by: "mei" },
  { id: "l2", from: "sha", to: "tyo", riders: ["mei", "ada"], by: "mei" },
  { id: "l3", from: "sel", to: "sha", riders: ["joon"], by: "joon" },
];

/**
 * edit_plan with three ops, the way it runs in a room: for each, Pip looks at where it goes (editTarget), writes it,
 * and broadcasts its marks, one after another with no waits between. A date and riders change no line; the new leg
 * draws out under the saucer.
 */
export const EDIT_PLAN: RoomScript = {
  members: { mei: { name: "Mei", color: 2 }, ada: { name: "Ada", color: 3 }, joon: { name: "Joon", color: 4 } },
  stops,
  before: trip,
  beats: [
    { wait: 300, event: { t: "presence", activity: "reading the trip", at: null }, note: "the run starts: Pip's presence says it's working" },
    { wait: 900, event: { t: "presence", activity: "editing the trip", at: at(stops.tyo) }, note: "model calls edit_plan; op 1, set_date: look() at the leg's end" },
    { wait: 20, event: { t: "marks", marks: [{ text: "Moved Shanghai Hongqiao → Tokyo to Sat 10 Oct", at: at(stops.tyo) }] }, note: "op 1 written" },
    { wait: 60, event: { t: "presence", activity: "editing the trip", at: at(stops.tyo) }, note: "op 2, set_riders" },
    {
      wait: 20,
      event: { t: "legs", legs: [trip[0], { ...trip[1], riders: ["mei", "ada", "joon"] }, trip[2]] },
      note: "op 2 written",
    },
    { wait: 20, event: { t: "marks", marks: [{ text: "Put Joon on Shanghai Hongqiao → Tokyo", at: at(stops.tyo) }] } },
    { wait: 60, event: { t: "presence", activity: "editing the trip", at: at(stops.tyo) }, note: "op 3, add_leg: look() at its start" },
    {
      wait: 20,
      event: {
        t: "legs",
        legs: [trip[0], { ...trip[1], riders: ["mei", "ada", "joon"] }, trip[2], { id: "l4", from: "tyo", to: "sel", riders: ["mei", "ada"], by: "mei" }],
      },
      note: "op 3 written",
    },
    { wait: 20, event: { t: "marks", marks: [{ text: "Added Tokyo → Seoul Incheon", at: at(stops.sel), leg: { from: at(stops.tyo), to: at(stops.sel) } }] } },
    { wait: 2000, event: { t: "presence", activity: null, at: null }, note: "searches done, reply written; presence clears" },
    { wait: 0, event: { t: "done" } },
  ],
};

/**
 * apply_meetup, the way it runs in a room: someone presses Go with this on a meet-up card (or asks Pip to), Pip
 * looks at the meeting place, and writes every group's leg there in one change, then broadcasts the marks.
 */
export const APPLY_MEETUP: RoomScript = {
  members: { mei: { name: "Mei", color: 2 }, joon: { name: "Joon", color: 4 } },
  stops,
  before: [],
  beats: [
    { wait: 300, event: { t: "presence", activity: "reading the trip", at: null }, note: "the run starts: Pip's presence says it's working" },
    { wait: 700, event: { t: "presence", activity: "putting the meet-up on the trip", at: at(stops.sha) }, note: "model calls apply_meetup; look() at where they meet" },
    {
      wait: 20,
      event: {
        t: "legs",
        legs: [
          { id: "l2", from: "hkg", to: "sha", riders: ["mei"], by: "mei" },
          { id: "l3", from: "sel", to: "sha", riders: ["joon"], by: "joon" },
        ],
      },
      note: "editPlan writes both legs",
    },
    {
      wait: 20,
      event: {
        t: "marks",
        marks: [
          { text: "Added HK West Kowloon → Shanghai Hongqiao", at: at(stops.sha), leg: { from: at(stops.hkg), to: at(stops.sha) } },
          { text: "Added Seoul Incheon → Shanghai Hongqiao", at: at(stops.sha), leg: { from: at(stops.sel), to: at(stops.sha) } },
        ],
      },
      note: "agent-marks broadcast",
    },
    { wait: 1500, event: { t: "presence", activity: null, at: null }, note: "reply written; presence clears" },
    { wait: 0, event: { t: "done" } },
  ],
};
