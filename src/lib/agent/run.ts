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

// One run of Pip in one trip room (harness G9): take the room's lease, answer the message that woke it, write the
// reply and cards into the thread, let go. Text streams by broadcast; Storage is written at tool boundaries only.

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

const SYSTEM = `You are ${AGENT_NAME}, the travel agent inside Portal, a shared globe where friends plan how to get between places in Asia.
Several people share this trip and see everything you write and change, live on their globes.

What you do: work out how to get between places. Add and change legs, find where people coming from different places should meet, compare routes.
What you don't do: itineraries, sights, hotels, restaurants or reviews. Say so in one sentence if asked.
You can't vote, pick an option for people, or pay; they do that themselves.

How to work:
- One person asked; the message below says who. Say "you" only to them, and name everyone else ("Joon's off the flight"), since everyone reads the thread.
- The trip below is current as of this turn. Refer to members, stops and legs by name in your replies; use handles (M1, S2, L3) only in tool calls.
- When someone asks you to change the trip, change it with edit_plan straight away. Every change you make can be undone, so don't ask for confirmation.
- For "where should we meet", call find_meetup. To add a meet-up someone picked ("go with the top one"), call apply_meetup with its P handle; don't search again. The card's button is "Add to trip".
- For fares or times on a leg, call get_leg_options.
- For who pays what, call get_split and quote it. Never add up costs yourself.
- Stays: you never estimate or look up what a stay costs. When someone says one ("our Shanghai flat is HKD 900 a night"), record it with set_stay_cost.
- Someone leaving early ("Mei leaves after Shanghai"): set_leaves to the day they go, and take them off the legs after it with set_riders. If they say how they get home, add that leg too.
- With no return legs, nobody sleeps at the last stop. If they say how long they stay there ("three nights in Tokyo"), set_trip_end. Never estimate fares, distances or durations yourself: quote tool numbers exactly, and say when a price is estimated.
- If a tool refuses, follow its "next" hint, or ask the one question you need.
- Dates: resolve "the 14th" or "next Friday" against today's date to YYYY-MM-DD.
- Get every number from tools before you write; your words stream to everyone as you write them, so never correct yourself mid-reply.
- Write like a friend who's good with timetables: one to three short sentences, plain words, no lists unless comparing, no exclamation marks or emoji. Cards already show the details, so don't repeat them.`;

const today = () => new Date().toISOString().slice(0, 10);
const newId = () => crypto.randomUUID().slice(0, 8);

export type RunOutcome = "ran" | "busy" | "not-found";

/** Answers one thread message. Resolves when the reply is written. */
export async function runAgent(roomId: string, messageId: string, askedBy: string): Promise<RunOutcome> {
  const lb = liveblocks();
  const runId = newId();
  const replyId = newId();
  const now = Date.now();

  // take the lease and post an empty reply in one write, so people see Pip start at once
  let outcome: RunOutcome = "ran";
  let overLimit = false;
  await lb.mutateStorage(roomId, ({ root }) => {
    const thread = root.get("thread");
    if (!thread?.some((m) => m.get("id") === messageId)) {
      outcome = "not-found";
      return;
    }
    const run = root.get("agentRun");
    const reply: ThreadMessage = { id: replyId, at: now, author: { kind: "agent" }, text: "", state: "streaming", cards: [] };
    if (run && run.until > now) {
      outcome = "busy";
      thread.push(new LiveObject({ ...reply, text: "I'm still on the last request. Ask me again in a moment.", state: "done" }));
      return;
    }
    root.set("agentRun", { id: runId, status: "running", by: askedBy, until: now + LEASE_MS });
    const day = new Date(now).toISOString().slice(0, 10);
    const usage = root.get("agentUsage");
    const runs = usage?.day === day ? usage.runs : 0;
    overLimit = runs >= TRIP_RUNS_PER_DAY;
    if (!overLimit) root.set("agentUsage", { day, runs: runs + 1 });
    thread.push(new LiveObject(reply));
  });
  if (outcome !== "ran") return outcome;

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

  let text = "";
  let sent = "";
  const flush = async () => {
    if (text === sent) return;
    sent = text;
    await lb.broadcastEvent(roomId, { type: "agent-text", messageId: replyId, text }).catch(() => {});
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
      addCard: (card: ThreadCard) => patchReply((m) => m.set("cards", [...m.get("cards"), card])),
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
          system: `${SYSTEM}\n\nThe trip now:\n${describePlan(plan, handles, ctx.today, askedBy)}`,
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
          }
          else if (part.type === "start-step" && text && !text.endsWith("\n")) text += "\n\n";
          else if (part.type === "error") throw part.error;
          else if (DEBUG && part.type === "tool-result") console.info("AGENT_TOOL_RESULT", part.toolName, JSON.stringify(part.output).slice(0, 600));
          else if (DEBUG && part.type === "tool-error") console.info("AGENT_TOOL_ERROR", part.toolName, String(part.error));
          else if (DEBUG && part.type === "finish") console.info("AGENT_FINISH", JSON.stringify(part.totalUsage));
        }
      } catch (error) {
        if (started || text) throw error;
        console.error("AGENT_MODEL_UNAVAILABLE", error instanceof Error ? error.message : error);
        text = await fallbackReply(plan, handles, messageId, ctx);
      }
    }

    clearInterval(ticker);
    const final = text.trim() || "Done.";
    await patchReply((m) => m.update({ text: final, state: "done" }));
  } catch (error) {
    clearInterval(ticker);
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
  return "ran";
}

/** Makes sure the thread exists, then appends a member's message. Returns its id. */
export async function postMessage(roomId: string, authorId: string, text: string) {
  const id = newId();
  await liveblocks().mutateStorage(roomId, ({ root }) => {
    const message: ThreadMessage = { id, at: Date.now(), author: { kind: "member", id: authorId }, text, state: "done", cards: [] };
    const thread = root.get("thread");
    if (thread) thread.push(new LiveObject(message));
    else root.set("thread", new LiveList([new LiveObject(message)]));
  });
  return id;
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

