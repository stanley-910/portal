"use client";

import { Activity, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref, type RefObject } from "react";

import { CardActionsContext, Composer, Launcher, PipClose, Suggestions, ThreadLog, useComposer, type CardActions, type Members } from "@/components/agent/agent-chat";
import { setPendingAction, useOpenAuth } from "@/components/auth/links";
import { pipPlace } from "@/components/agent/pip-arrival";
import { usePipFrame } from "@/components/agent/pip-frame";
import { PipEdges } from "@/components/agent/pip-edges";
import { PipSaucer, type PipSaucerHandle, type SaucerBuild } from "@/components/agent/pip-saucer";
import { PipSprite, type PipMood } from "@/components/agent/pip-sprite";
import type { LatLng, TripGlobeHandle } from "@/components/trip-globe";
import { readSoloEvents } from "./solo-stream";
import { recordTiming } from "@/lib/performance";
import { changeStart, type AgentMark } from "@/lib/agent/marks";
import type { SoloEvent, SoloLeg } from "@/lib/agent/solo";
import { AGENT_NAME, type ThreadCard, type ThreadMessage } from "@/lib/agent/types";
import { SIGN_IN_TO_ASK } from "@/lib/agent/use-thread";

// Pip on the home globe, before there's a trip: no room and no session. The conversation lives in this page, each
// reply streams from /api/pip, and the legs Pip plans land on this globe like ones you flew, where the trip card
// searches fares and Save trip keeps them in your account. Friends join a saved trip from its link.

// Pip's hello on the home globe: one of these, picked at random once per page load
const NUDGES = [
  `Hi, I'm ${AGENT_NAME}. Where are you headed?`,
  `Greetings, Earthling. I'm ${AGENT_NAME}. Where to?`,
  `Hi, I'm ${AGENT_NAME}, galactic trip planner. Where to?`,
  `Hi, I'm ${AGENT_NAME}. Pick a place, I'll find the way.`,
];
const CHIPS = [
  "Train from Hong Kong to Shanghai on Friday",
  "I'm in Hong Kong, my friend's in Seoul. Where should we meet?",
  "Cheapest way from Taipei to Tokyo next week",
];
const ME = "me";
const MEMBERS: Members = { [ME]: { name: "You", color: 1 } };
const HISTORY = 16;

const newId = () => crypto.randomUUID().slice(0, 8);

type Props = {
  /** The home globe, where Pip's saucer flies while it works. */
  globe: RefObject<TripGlobeHandle | null>;
  /** Pip needs an account. A guest's first message waits behind sign-in and goes out once they're in. */
  account: boolean;
  /** The legs on the globe now, for Pip to see. */
  trip: SoloLeg[];
  /** Puts the legs Pip planned on the globe. */
  onTrip: (legs: SoloLeg[]) => void;
  /** `ask` opens the chat and sends a message: the one a guest typed before signing in. */
  ref?: Ref<HomePipHandle>;
};

export type HomePipHandle = { ask: (text: string) => void };

export function HomePip({ globe, account, trip, onTrip, ref }: Props) {
  const [open, setOpen] = useState(false);
  const openAuth = useOpenAuth();
  const saucer = useRef<PipSaucerHandle>(null);
  // moved by its header, sized from its corner
  const { panel: framed, style: frameStyle, placed, onMove, onSize } = usePipFrame();
  const { thread, activity, at, globeWork, send, apply, busy, stop, retry, appliedReplies } = useSoloPip(trip, onTrip, (marks, build) => {
    if (saucer.current) saucer.current.play(marks, build);
    else build?.run();
  });

  const ask = async (text: string) => {
    if (account) return send(text);
    setPendingAction({ type: "pip", text });
    openAuth("signup");
  };

  useImperativeHandle(ref, () => ({
    ask: (text) => {
      setOpen(true);
      void send(text).catch(() => {});
    },
  }));

  const composer = useComposer(ask);
  const actions = useMemo<CardActions>(() => ({ apply, retry, appliedReplies, applyLabel: "Go with this" }), [apply, retry, appliedReplies]);
  const streaming = thread.find((m) => m.state === "streaming");
  const mood: PipMood = streaming ? (streaming.text ? "talk" : "think") : "idle";
  const line = trip.length ? [trip[0].from.name, ...trip.map((l) => l.to.name)].join(" → ") : "New trip";
  const chips = trip.length
    ? [`What's cheapest from ${trip[0].from.name} to ${trip[0].to.name}?`, `How do I get back to ${trip[0].from.name}?`, "Add another stop"]
    : CHIPS;

  const flying = <PipSaucer ref={saucer} globe={globe} at={at} busy={!!streaming} expect={globeWork} />;
  return (
    <>
      {flying}
      {!open ? <Launcher unread={false} nudges={NUDGES} onOpen={() => setOpen(true)} /> : null}
      <Activity mode={open ? "visible" : "hidden"}>
      <section ref={framed} style={frameStyle} data-placed={placed || undefined} data-globe-obstacle className={`pip-panel${pipPlace.side === "left" ? " pip-panel-left" : ""}`} aria-label={`Plan a trip with ${AGENT_NAME}`}>
        <header className="pip-head" data-draggable="" onPointerDown={onMove}>
          <PipSprite size={32} mood={mood} portal />
          <div className="min-w-0 flex-1">
            <p className="pip-head-name">{AGENT_NAME}</p>
            <p className="pip-head-sub">{line}</p>
          </div>
          <PipClose onClick={() => setOpen(false)} />
        </header>
        <CardActionsContext value={actions}>
          <ThreadLog thread={thread} me={ME} members={MEMBERS} activity={activity} footer={<Suggestions composer={composer} chips={chips} />}>
            <div className="pip-msg-agent">
              <div className="pip-msg-agent-body">
                <span className="pip-label">{AGENT_NAME}</span>
                <p className="pip-text">Where are you headed? I&apos;ll put the trip on your globe and find the routes. Save it to keep it, and bring friends in with its link.</p>
              </div>
            </div>
          </ThreadLog>
        </CardActionsContext>
        <Composer composer={composer} placeholder={`Tell ${AGENT_NAME} where you're going`} onStop={busy ? stop : undefined} />
        {/* drag any edge or corner to resize */}
        <PipEdges onSize={onSize} />
      </section>
      </Activity>
    </>
  );
}

/**
 * The home conversation: sends each message with the recent history and the legs on the globe, and applies the
 * streamed reply as it comes. Text is applied once a frame, so a fast stream doesn't re-render per token.
 */
function useSoloPip(trip: SoloLeg[], onTrip: (legs: SoloLeg[]) => void, onMarks: (marks: AgentMark[], build?: SaucerBuild) => void) {
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [appliedReplies, setAppliedReplies] = useState<ReadonlySet<string>>(() => new Set());
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const stop = useCallback(() => active.current?.abort(), []);
  const [activity, setActivity] = useState<string | null>(null);
  // where Pip last looked on the globe, this reply
  const [at, setAt] = useState<LatLng | null>(null);
  // a tool whose work shows on the globe is running: Pip heads out to it before it knows where
  const [globeWork, setGlobeWork] = useState(false);
  const threadRef = useRef(thread);
  useLayoutEffect(() => { threadRef.current = thread; }, [thread]);
  const tripRef = useRef({ trip, onTrip, onMarks });
  useLayoutEffect(() => { tripRef.current = { trip, onTrip, onMarks }; }, [trip, onTrip, onMarks]);

  const patch = (id: string, change: (m: ThreadMessage) => ThreadMessage) =>
    setThread((t) => t.map((m) => (m.id === id ? change(m) : m)));

  const send = async (text: string) => {
    if (active.current) throw new Error("Wait for this reply or stop it first.");
    const started = performance.now();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    const mine: ThreadMessage = { id: newId(), at: Date.now(), author: { kind: "member", id: ME }, text, state: "done", cards: [] };
    const replyId = newId();
    const reply: ThreadMessage = { id: replyId, at: Date.now(), author: { kind: "agent" }, text: "", state: "streaming", cards: [] };
    const messages = [...threadRef.current, mine]
      .filter((m) => m.text.trim() && m.state !== "streaming")
      .slice(-HISTORY)
      .map((m) => ({ role: m.author.kind === "agent" ? ("assistant" as const) : ("user" as const), text: m.text }));
    setThread((t) => [...t, mine, reply]);
    setAt(null);

    const res = await fetch("/api/pip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, trip: tripRef.current.trip }),
      signal: controller.signal,
    }).catch(() => null);
    if (!res?.ok || !res.body) {
      // take the message back out, so the composer keeps the draft to send again
      setThread((t) => t.filter((m) => m.id !== mine.id && m.id !== replyId));
      active.current = null;
      setBusy(false);
      throw new Error(res?.status === 401 ? SIGN_IN_TO_ASK : `pip failed: ${res?.status ?? "network"}`);
    }
    try { await read(res.body, replyId, controller.signal, started); }
    finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  };

  const read = async (body: ReadableStream<Uint8Array>, id: string, signal: AbortSignal, started: number) => {
    let text = "";
    let frame = 0;
    // globe tool calls still running
    const running = new Set<string>();
    // legs Pip planned, held for the saucer to put down once it's where they start (the marks that follow say where)
    let planned: SoloLeg[] | null = null;
    const putDown = (legs: SoloLeg[]) => {
      tripRef.current.onTrip(legs);
      recordTiming("plan-applied", started);
    };
    const flushText = () => {
      frame = 0;
      if (signal.aborted) return;
      patch(id, (m) => ({ ...m, text }));
    };
    const apply = (event: SoloEvent) => {
      if (signal.aborted) return;
      if (event.t === "text") {
        if (!text && event.d) recordTiming("pip-first-text", started);
        text += event.d;
        frame ||= requestAnimationFrame(flushText);
      } else if (event.t === "step") {
        if (event.globe) {
          if (event.done) running.delete(event.id);
          else running.add(event.id);
          setGlobeWork(running.size > 0);
        }
        const step: ThreadCard = { type: "status", id: event.id, label: event.label, done: event.done, at: event.at };
        patch(id, (m) => ({
          ...m,
          cards: m.cards.some((c) => c.type === "status" && c.id === event.id)
            ? m.cards.map((c) => (c.type === "status" && c.id === event.id ? { ...step, at: c.at } : c))
            : [...m.cards, step],
        }));
      } else if (event.t === "card") patch(id, (m) => ({ ...m, cards: [...m.cards, event.card] }));
      else if (event.t === "activity") {
        setActivity(event.label);
        // a tool looks somewhere while it works; done, it isn't looking there any more
        setAt(event.label ? (event.at ?? null) : null);
      } else if (event.t === "trip") {
        setAppliedReplies((ids) => new Set(ids).add(id));
        if (planned) putDown(planned);
        planned = event.legs;
      } else if (event.t === "marks") {
        const legs = planned;
        planned = null;
        const from = event.marks.some((m) => m.leg) && legs ? changeStart(tripRef.current.trip, legs) : null;
        if (legs && from) tripRef.current.onMarks(event.marks, { from, run: () => putDown(legs) });
        else {
          if (legs) putDown(legs);
          tripRef.current.onMarks(event.marks);
        }
      }
      else if (event.t === "done" || event.t === "failed") {
        cancelAnimationFrame(frame);
        setActivity(null);
        setGlobeWork(false);
        patch(id, (m) => ({ ...m, text: text.trim() || m.text, state: event.t === "done" ? "done" : "failed" }));
      }
    };
    try { await readSoloEvents(body, signal, apply); }
    catch { /* Keep the partial reply and mark it interrupted below. */ }
    finally {
      cancelAnimationFrame(frame);
      // a trip with no marks after it still goes on the globe
      if (planned && !signal.aborted) putDown(planned);
    }
    // a stream that ended without saying so
    setThread((t) =>
      t.map((m) => (m.id === id && m.state === "streaming" ? { ...m, text: text.trim() || (signal.aborted ? "Reply stopped." : "I lost the connection. Try again."), state: "failed" } : m)),
    );
    setActivity(null);
    setGlobeWork(false);
  };

  /** "Go with this" on a meet-up: puts your own leg to the meeting place on the globe. */
  const apply = useCallback((messageId: string, option: string) => {
    const message = threadRef.current.find((m) => m.id === messageId);
    const card = message?.cards.find((c): c is Extract<ThreadCard, { type: "meetup" }> => c.type === "meetup");
    const o = card?.options.find((x) => x.id === option);
    const leg = o?.legs[0];
    if (!o || !leg) return;
    tripRef.current.onTrip([{ from: { ...leg.from }, to: { name: o.place.name, lat: o.place.lat, lng: o.place.lng, hub: o.place.hub, code: o.place.code }, date: o.date }]);
    patch(messageId, (m) => ({ ...m, cards: m.cards.map((c) => (c === card ? { ...card, applied: option } : c)) }));
  }, []);
  const sendRef = useRef(send);
  useLayoutEffect(() => { sendRef.current = send; });
  const retry = useCallback((id: string) => {
    if (appliedReplies.has(id)) return;
    const at = threadRef.current.findIndex((m) => m.id === id);
    const previous = threadRef.current.slice(0, at).findLast((m) => m.author.kind === "member");
    if (previous && !active.current) void sendRef.current(previous.text).catch(() => {});
  }, [appliedReplies]);
  return { thread, activity, at, globeWork, send, apply, busy, stop, retry, appliedReplies };
}
