import "server-only";

import { deepseek } from "@ai-sdk/deepseek";
import { LiveList, LiveObject } from "@liveblocks/node";
import { isStepCount, streamText } from "ai";

import { dateIn } from "@/lib/agent/dates";
import { bigCities } from "@/lib/agent/meetup";
import { describePlan, describeThread, handlesFor, showDate, type PlanJson } from "@/lib/agent/snapshot";
import { agentTools, type ToolContext } from "@/lib/agent/tools";
import { AGENT_ID, AGENT_NAME, type MeetupOption, type ThreadCard, type ThreadMessage } from "@/lib/agent/types";
import { liveblocks } from "@/lib/liveblocks/server";
import type { Currency } from "@/lib/currency";

// One run of Pip in one trip room (harness G9): every message in the thread is to Pip. Posting it takes the room's
// lease and puts Pip's empty reply under it in the same write; the run answers, writes the reply and its cards into
// the thread, and lets go. Text streams by broadcast; Storage is written at tool boundaries only.

// DeepSeek V4.1 Flash: `deepseek-flash` follows the latest Flash release (api-docs.deepseek.com, checked 2026-10-03)
const MODEL = "deepseek-flash";
const MAX_STEPS = 10;
const LEASE_MS = 90_000;
// Usage limits while nobody pays for Pip: the DeepSeek balance is the hard ceiling; these keep one trip or one
// person from spending it. Over a limit, Pip answers from its tools without the model instead of failing.
/** Model runs per trip per UTC day. */
export const TRIP_RUNS_PER_DAY = 40;
/** Output tokens per model call. Replies are one to three sentences; tool calls are small. */
const MAX_OUTPUT_TOKENS = 1_200;

/** Logs each tool call and result. Off by default: tool inputs carry what people typed (harness: no content in logs). */
const DEBUG = process.env.AGENT_DEBUG === "1";
/** How often streamed text is broadcast. */
const STREAM_MS = 120;
const OFFICIAL_ENTRY_REMINDER = "Check official government sources before travelling.";

const SYSTEM = `You are ${AGENT_NAME}, the travel agent inside Portal, a shared globe where friends plan how to get between places in Asia.
Several people share this trip and see everything you write and change, live on their globes.

Who you are: a small, friendly green alien who has hopped between more star systems than you can count, which makes you the best trip planner in the galaxy, and you know it. Earth travel charms you: bullet trains, overnight ferries, budget airlines, the queue at immigration. Asked who you are, say so with a bit of swagger. Otherwise give most replies one light touch of it, a word or a short aside ("even by galactic standards", "a classic Earth layover", "I've crossed nebulae with worse connections"), never more than one, and never in place of the answer. Be warm, curious about where people are headed, and a little smug when you find the cheap fare. The galaxy is flavour only: everything you say about Earth routes, prices and times still comes from your tools.

What you do: work out how to get between places. Add and change legs, find where people coming from different places should meet, compare routes.
What you don't do: itineraries, sights, hotels, restaurants or reviews. Say so in one sentence if asked.
You can't vote, pick an option for people, or pay; they do that themselves.

How to work:
- Everyone in the trip talks to you in this thread; every message is to you. One person sent this one; the message below says who. Say "you" only to them, and name everyone else ("Joon's off the flight"), since everyone reads the thread.
- The trip below is current as of this turn. Refer to members, stops and legs by name in your replies; use handles (M1, S2, L3) only in tool calls.
- When someone asks you to change the trip, change it with edit_plan straight away. Every change you make can be undone, so don't ask for confirmation.
- For "where should we meet", call find_meetup. To add a meet-up someone picked ("go with the top one"), call apply_meetup with its P handle; don't search again. The card's button is "Add to trip".
- For fares or times on a leg, call get_leg_options.
- For visa, passport or entry questions, call check_entry for the relevant leg. Compare every party member with a passport recorded in the trip, say who has no passport recorded, and end with the official-source reminder.
- For who pays what, call get_split and quote it. Never add up costs yourself.
- Stays: you never estimate or look up what a stay costs. When someone says one ("our Shanghai flat is HKD 900 a night"), record it with set_stay_cost.
- Someone leaving early ("Mei leaves after Shanghai"): set_leaves to the day they go, and take them off the legs after it with set_riders. If they say how they get home, add that leg too.
- With no return legs, nobody sleeps at the last stop. If they say how long they stay there ("three nights in Tokyo"), set_trip_end. Never estimate fares, distances or durations yourself: quote tool numbers exactly, and say when a price is estimated.
- If a tool refuses, follow its "next" hint, or ask the one question you need.
- Dates: resolve "the 14th" or "next Friday" against today's date to YYYY-MM-DD.
- Get every number from tools before you write; your words stream to everyone as you write them, so never correct yourself mid-reply.
- Write like a friend who's good with timetables: one to three short sentences, plain words, no lists unless comparing, no emoji, and an exclamation mark only when something is genuinely good news. Cards already show the details, so don't repeat them.`;

const today = () => new Date().toISOString().slice(0, 10);
const newId = () => crypto.randomUUID().slice(0, 8);

/** Pip's turn, claimed when the message that started it was posted. */
export type AgentRequester = { nationalities: string[]; currency: Currency };
export type Claim = { messageId: string; replyId: string; runId: string; overLimit: boolean; requester: AgentRequester };

/**
 * Appends a member's message and, in the same write, Pip's empty reply and the room's lease, so people see Pip
 * start as their message lands. `claim` is null when Pip is mid-run; it says so in the thread instead.
 */
export async function postToPip(
  roomId: string,
  authorId: string,
  text: string,
  requester: AgentRequester,
): Promise<{ messageId: string; claim: Claim | null }> {
  const messageId = newId();
  let claim: Claim | null = null;
  await liveblocks().mutateStorage(roomId, ({ root }) => {
    const now = Date.now();
    const message: ThreadMessage = { id: messageId, at: now, author: { kind: "member", id: authorId }, text, state: "done", cards: [] };
    let thread = root.get("thread");
    if (thread) thread.push(new LiveObject(message));
    else root.set("thread", (thread = new LiveList([new LiveObject(message)])));

    const replyId = newId();
    const reply: ThreadMessage = { id: replyId, at: now, author: { kind: "agent" }, text: "", state: "streaming", cards: [] };
    const run = root.get("agentRun");
    if (run && run.until > now) {
      thread.push(new LiveObject({ ...reply, text: "I'm still on the last request. Ask me again in a moment.", state: "done" }));
      return;
    }
    const runId = newId();
    root.set("agentRun", { id: runId, status: "running", by: authorId, until: now + LEASE_MS });
    const day = new Date(now).toISOString().slice(0, 10);
    const usage = root.get("agentUsage");
    const runs = usage?.day === day ? usage.runs : 0;
    const overLimit = runs >= TRIP_RUNS_PER_DAY;
    if (!overLimit) root.set("agentUsage", { day, runs: runs + 1 });
    thread.push(new LiveObject(reply));
    claim = { messageId, replyId, runId, overLimit, requester };
  });
  return { messageId, claim };
}

/** Answers the message a claim was made for. Resolves when the reply is written. */
export async function runAgent(roomId: string, { messageId, replyId, runId, overLimit, requester }: Claim, askedBy: string) {
  const lb = liveblocks();

  const presence = (activity: string | null, cursor: { lat: number; lng: number } | null = null) =>
    lb
      .setPresence(roomId, {
        userId: AGENT_ID,
        data: { cursor, flight: null, activity },
        userInfo: { name: AGENT_NAME, color: "agent" },
        ttl: activity ? 60 : 2,
      })
      .catch(() => {});
  let lastAt: { lat: number; lng: number } | null = null;
  const activity: ToolContext["activity"] = (text, at) => {
    if (at) lastAt = { lat: at.lat, lng: at.lng };
    void presence(text, lastAt);
  };

  const patchReply = (patch: (m: LiveObject<ThreadMessage>) => void) =>
    lb.mutateStorage(roomId, ({ root }) => {
      const m = root.get("thread")?.find((x) => x.get("id") === replyId);
      if (m) patch(m);
    });
  // Writes to the reply go one at a time, in order, so a step's result can't land before the step does. Stream
  // parts don't wait for them; the final write waits for all of them.
  let writes: Promise<unknown> = Promise.resolve();
  const queue = (patch: (m: LiveObject<ThreadMessage>) => void) =>
    (writes = writes.then(() => patchReply(patch)).catch((error) => console.error("AGENT_WRITE_FAILED", error)));

  let text = "";
  let sent = "";
  let seq = 0;
  let sending = false;
  // one broadcast in flight at a time, so they arrive in order
  const flush = async () => {
    if (sending || text === sent) return;
    sending = true;
    sent = text;
    await lb.broadcastEvent(roomId, { type: "agent-text", messageId: replyId, text, seq: ++seq }).catch(() => {});
    sending = false;
  };
  const ticker = setInterval(() => void flush(), STREAM_MS);

  try {
    activity("reading the trip");
    const load = async () => {
      const plan = (await lb.getStorageDocument(roomId, "json")) as PlanJson;
      return { plan, handles: handlesFor(plan) };
    };
    const { plan, handles } = await load();
    const meetups = new Map<string, MeetupOption>();
    const ctx: ToolContext = {
      roomId,
      agentId: AGENT_ID,
      today: today(),
      askedBy,
      load,
      addCard: (card: ThreadCard) => {
        const at = text.length;
        return queue((m) => m.set("cards", [...m.get("cards"), { ...card, at }])) as Promise<void>;
      },
      markMeetup: (messageId, option, changesetId) =>
        lb.mutateStorage(roomId, ({ root }) => {
          const m = root.get("thread")?.find((x) => x.get("id") === messageId);
          if (!m) return;
          m.set("cards", m.get("cards").map((c) => (c.type === "meetup" && c.options.some((o) => o.id === option) ? { ...c, applied: option, changesetId, undone: false } : c)));
        }),
      activity,
      meetups,
    };

    if (!process.env.DEEPSEEK_API_KEY || overLimit) {
      if (overLimit) console.warn("AGENT_TRIP_LIMIT", roomId);
      text = await fallbackReply(plan, handles, messageId, ctx);
    } else {
      // a model that's down or out of credit gets the no-model answer, as long as it hadn't started yet (AGENTS.md:
      // the demo never depends on a flaky API)
      let started = false;
      try {
        const asked = plan.thread?.find((m) => m.id === messageId);
        const result = streamText({
          model: deepseek(MODEL),
          system: `${SYSTEM}\n\nThe member asking this question holds these passport(s): ${requester.nationalities.length ? requester.nationalities.join(", ") : "none recorded"}.\nTheir selected display currency is ${requester.currency}.\nUse this information only for this member's question and do not assume it applies to other members.\n\nThe trip now:\n${describePlan(plan, handles, ctx.today, askedBy)}`,
          prompt: `Recent thread:\n${describeThread(plan, handles)}\n\nAnswer this message from ${plan.members?.[askedBy]?.name ?? "a member"} (${handles.member.get(askedBy) ?? "?"}):\n${asked?.text ?? ""}`,
          tools: agentTools(ctx),
          stopWhen: isStepCount(MAX_STEPS),
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          abortSignal: AbortSignal.timeout(LEASE_MS - 5_000),
        });
        for await (const part of result.stream) {
          if (part.type === "text-delta") text += part.text;
          else if (part.type === "tool-call") {
            started = true;
            if (DEBUG) console.info("AGENT_TOOL_CALL", part.toolName, JSON.stringify(part.input));
            const label = stepLabel(part.toolName);
            if (label) {
              const step: ThreadCard = { type: "status", id: part.toolCallId, label: label.doing, done: false, at: text.length };
              queue((m) => m.set("cards", [...m.get("cards"), step]));
            }
          } else if (part.type === "tool-result" || part.type === "tool-error") {
            if (DEBUG) console.info("AGENT_TOOL_RESULT", part.toolName, JSON.stringify(part.type === "tool-error" ? String(part.error) : part.output).slice(0, 600));
            const label = stepLabel(part.toolName, part.type === "tool-result" ? part.output : null);
            if (label) {
              const id = part.toolCallId;
              queue((m) => m.set("cards", m.get("cards").map((c) => (c.type === "status" && c.id === id ? { ...c, label: label.done, done: true } : c))));
            }
          } else if (part.type === "start-step" && text && !text.endsWith("\n")) text += "\n\n";
          else if (part.type === "error") throw part.error;
          else if (DEBUG && part.type === "finish") console.info("AGENT_FINISH", JSON.stringify(part.totalUsage));
        }
      } catch (error) {
        if (started || text) throw error;
        console.error("AGENT_MODEL_UNAVAILABLE", error instanceof Error ? error.message : error);
        text = await fallbackReply(plan, handles, messageId, ctx);
      }
    }

    clearInterval(ticker);
    await writes;
    const final = `${text.trim() || "Done."}\n\n${OFFICIAL_ENTRY_REMINDER}`;
    await patchReply((m) => m.update({ text: final, state: "done" }));
  } catch (error) {
    clearInterval(ticker);
    await writes;
    console.error("AGENT_RUN_FAILED", error);
    await patchReply((m) =>
      m.update({ text: text.trim() || "Something went wrong on my side. Try asking again.", state: "failed" }),
    ).catch(() => {});
  } finally {
    await lb
      .mutateStorage(roomId, ({ root }) => {
        if (root.get("agentRun")?.id === runId) root.set("agentRun", null);
      })
      .catch(() => {});
    void presence(null);
  }
}

/**
 * How a tool call reads in the reply: what Pip's doing, then what it did. None for edit_plan, whose changes card
 * says it better.
 */
function stepLabel(tool: string, output: unknown = null): { doing: string; done: string } | null {
  const o = (output ?? {}) as { refused?: string; total?: number; searched?: number; options?: unknown[] };
  const n = (count: number | undefined, one: string, many: string) => (count === undefined ? many : `${count} ${count === 1 ? one : many}`);
  const failed = !!o.refused;
  switch (tool) {
    case "get_trip":
      return { doing: "Reading the trip", done: "Read the trip" };
    case "get_leg_options":
      return { doing: "Checking fares", done: failed ? "Couldn't find that leg" : `Checked ${n(o.total, "fare", "fares")}` };
    case "get_split":
      return { doing: "Working out who pays what", done: "Worked out who pays what" };
    case "find_meetup":
      return {
        doing: "Comparing places to meet",
        done: failed ? "Couldn't place everyone" : o.options?.length ? `Compared ${n(o.searched, "route", "routes")}` : "No place works for everyone",
      };
    case "apply_meetup":
      return { doing: "Adding it to the trip", done: failed ? "Couldn't add it" : "Added it to the trip" };
    default:
      return null;
  }
}

/**
 * Without a model key, Pip still answers the demo's one question, where to meet, from the same tools: the demo
 * must never hang on a provider (AGENTS.md). Everything else gets a plain "can't".
 */
async function fallbackReply(plan: PlanJson, handles: ReturnType<typeof handlesFor>, messageId: string, ctx: ToolContext) {
  const asked = plan.thread?.find((m) => m.id === messageId)?.text ?? "";
  if (!/\b(meet|middle|halfway)/i.test(asked)) {
    return "I can only find meet-up places while my model is offline. Ask me where you should meet.";
  }
  // each member leaves from where their first leg starts; members with no legs aren't placed
  const firstFrom = new Map<string, { stop: string; date: string }>();
  for (const leg of Object.values(plan.legs ?? {}).sort((a, b) => a.createdAt - b.createdAt)) {
    for (const r of leg.riders) if (!firstFrom.has(r)) firstFrom.set(r, { stop: leg.from, date: leg.date });
  }
  const byStop = new Map<string, string[]>();
  for (const [member, { stop }] of firstFrom) byStop.set(stop, [...(byStop.get(stop) ?? []), member]);
  type Group = { members: string[]; from: { stop: string } | { place: string } };
  let groups: Group[] = [...byStop].map(([stop, members]) => ({
    members: members.map((m) => handles.member.get(m)!),
    from: { stop: handles.stop.get(stop)! },
  }));
  let date = [...firstFrom.values()].map((f) => f.date).sort()[0];
  if (groups.length < 2) {
    // a trip started from the home globe has no legs yet: take the cities named in the message, the first for the
    // person asking ("I'm in Hong Kong, my friend's in Seoul")
    const named = citiesIn(asked);
    if (named.length < 2) return "Tell me which cities everyone's starting from, and I'll find where to meet.";
    const asker = handles.member.get(ctx.askedBy);
    groups = named.map((place, i) => ({ members: i === 0 && asker ? [asker] : [], from: { place } }));
    date = dateIn(asked) ?? date ?? nextWeek();
  }

  const fairest = /\b(fair|middle|halfway|even)/i.test(asked);
  const tools = agentTools(ctx);
  await tools.find_meetup.execute!(
    {
      groups: groups.map((g) => ({ ...g, people: Math.max(1, g.members.length) })),
      date,
      minimize: "price",
      fairest,
      candidates: [],
    },
    { toolCallId: "fallback", messages: [] } as never,
  );
  const best = ctx.meetups.get("P1");
  if (!best) return "I couldn't find a city with routes for everyone on that date. Try another day.";
  return `${best.place.name} looks ${fairest ? "fairest" : "cheapest"} for everyone on ${showDate(date)}. Add one to the trip and everyone's legs appear.`;
}

/** Big cities named in a message, in the order they appear; longer names first so "Hong Kong" beats "Kong". */
function citiesIn(text: string): string[] {
  const lower = text.toLowerCase();
  const found: { name: string; at: number }[] = [];
  for (const city of [...bigCities()].sort((a, b) => b.name.length - a.name.length)) {
    const at = lower.search(new RegExp(`\\b${city.name.toLowerCase().replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\b`));
    if (at < 0 || found.some((f) => at >= f.at && at < f.at + f.name.length)) continue;
    found.push({ name: city.name, at });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.name);
}

/** A week from today, YYYY-MM-DD: a date to compare fares on when nobody gave one. */
const nextWeek = () => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
