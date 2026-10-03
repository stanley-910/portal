"use client";

import { useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";

import { CardActionsContext, Composer, Launcher, PipClose, ThreadLog, type CardActions, type Members } from "@/components/agent/agent-chat";
import { setPendingAction, useOpenAuth } from "@/components/auth/links";
import { pipPlace } from "@/components/agent/pip-arrival";
import { PipSprite, type PipMood } from "@/components/agent/pip-sprite";
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

export function HomePip({ account, trip, onTrip, ref }: Props) {
  const [open, setOpen] = useState(false);
  const openAuth = useOpenAuth();
  const { thread, activity, send, apply } = useSoloPip(trip, onTrip);

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

  const actions = useMemo<CardActions>(() => ({ apply, applyLabel: "Go with this" }), [apply]);
  const streaming = thread.find((m) => m.state === "streaming");
  const mood: PipMood = streaming ? (streaming.text ? "talk" : "think") : "idle";
  const line = trip.length ? [trip[0].from.name, ...trip.map((l) => l.to.name)].join(" → ") : "New trip";
  const chips = trip.length
    ? [`What's cheapest from ${trip[0].from.name} to ${trip[0].to.name}?`, `How do I get back to ${trip[0].from.name}?`, "Add another stop"]
    : CHIPS;

  if (!open) return <Launcher unread={false} nudges={NUDGES} onOpen={() => setOpen(true)} />;
  return (
    <section className={`pip-panel${pipPlace.side === "left" ? " pip-panel-left" : ""}`} aria-label={`Plan a trip with ${AGENT_NAME}`}>
      <header className="pip-head">
        <PipSprite size={32} mood={mood} />
        <div className="min-w-0 flex-1">
          <p className="pip-head-name">{AGENT_NAME}</p>
          <p className="pip-head-sub">{line}</p>
        </div>
        <PipClose onClick={() => setOpen(false)} />
      </header>
      <CardActionsContext value={actions}>
        <ThreadLog thread={thread} me={ME} members={MEMBERS} activity={activity}>
          <div className="pip-msg-agent">
            <div className="pip-msg-agent-body">
              <span className="pip-label">{AGENT_NAME}</span>
              <p className="pip-text">Where are you headed? I&apos;ll put the trip on your globe and find the routes. Save it to keep it, and bring friends in with its link.</p>
            </div>
          </div>
        </ThreadLog>
      </CardActionsContext>
      <Composer chips={chips} send={ask} placeholder={`Tell ${AGENT_NAME} where you're going`} />
    </section>
  );
}

/**
 * The home conversation: sends each message with the recent history and the legs on the globe, and applies the
 * streamed reply as it comes. Text is applied once a frame, so a fast stream doesn't re-render per token.
 */
function useSoloPip(trip: SoloLeg[], onTrip: (legs: SoloLeg[]) => void) {
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [activity, setActivity] = useState<string | null>(null);
  const threadRef = useRef(thread);
  threadRef.current = thread;
  const tripRef = useRef({ trip, onTrip });
  tripRef.current = { trip, onTrip };

  const patch = (id: string, change: (m: ThreadMessage) => ThreadMessage) =>
    setThread((t) => t.map((m) => (m.id === id ? change(m) : m)));

  const send = async (text: string) => {
    const mine: ThreadMessage = { id: newId(), at: Date.now(), author: { kind: "member", id: ME }, text, state: "done", cards: [] };
    const replyId = newId();
    const reply: ThreadMessage = { id: replyId, at: Date.now(), author: { kind: "agent" }, text: "", state: "streaming", cards: [] };
    const messages = [...threadRef.current, mine]
      .filter((m) => m.text.trim() && m.state !== "streaming")
      .slice(-HISTORY)
      .map((m) => ({ role: m.author.kind === "agent" ? ("assistant" as const) : ("user" as const), text: m.text }));
    setThread((t) => [...t, mine, reply]);

    const res = await fetch("/api/pip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, trip: tripRef.current.trip }),
    }).catch(() => null);
    if (!res?.ok || !res.body) {
      // take the message back out, so the composer keeps the draft to send again
      setThread((t) => t.filter((m) => m.id !== mine.id && m.id !== replyId));
      throw new Error(res?.status === 401 ? SIGN_IN_TO_ASK : `pip failed: ${res?.status ?? "network"}`);
    }
    void read(res.body, replyId);
  };

  const read = async (body: ReadableStream<Uint8Array>, id: string) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let frame = 0;
    const flushText = () => {
      frame = 0;
      patch(id, (m) => ({ ...m, text }));
    };
    const apply = (event: SoloEvent) => {
      if (event.t === "text") {
        text += event.d;
        frame ||= requestAnimationFrame(flushText);
      } else if (event.t === "step") {
        const step: ThreadCard = { type: "status", id: event.id, label: event.label, done: event.done, at: event.at };
        patch(id, (m) => ({
          ...m,
          cards: m.cards.some((c) => c.type === "status" && c.id === event.id)
            ? m.cards.map((c) => (c.type === "status" && c.id === event.id ? { ...step, at: c.at } : c))
            : [...m.cards, step],
        }));
      } else if (event.t === "card") patch(id, (m) => ({ ...m, cards: [...m.cards, event.card] }));
      else if (event.t === "activity") setActivity(event.label);
      else if (event.t === "trip") tripRef.current.onTrip(event.legs);
      else if (event.t === "done" || event.t === "failed") {
        cancelAnimationFrame(frame);
        setActivity(null);
        patch(id, (m) => ({ ...m, text: text.trim() || m.text, state: event.t === "done" ? "done" : "failed" }));
      }
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.trim()) apply(JSON.parse(line) as SoloEvent);
        }
      }
    } catch {
      // the connection dropped: keep what arrived
    }
    // a stream that ended without saying so
    setThread((t) =>
      t.map((m) => (m.id === id && m.state === "streaming" ? { ...m, text: text.trim() || "I lost the connection. Try again.", state: "failed" } : m)),
    );
    setActivity(null);
  };

  /** "Go with this" on a meet-up: puts your own leg to the meeting place on the globe. */
  const apply = (messageId: string, option: string) => {
    const message = threadRef.current.find((m) => m.id === messageId);
    const card = message?.cards.find((c): c is Extract<ThreadCard, { type: "meetup" }> => c.type === "meetup");
    const o = card?.options.find((x) => x.id === option);
    const leg = o?.legs[0];
    if (!o || !leg) return;
    tripRef.current.onTrip([{ from: { ...leg.from }, to: { name: o.place.name, lat: o.place.lat, lng: o.place.lng, hub: o.place.hub, code: o.place.code }, date: o.date }]);
    patch(messageId, (m) => ({ ...m, cards: m.cards.map((c) => (c === card ? { ...card, applied: option } : c)) }));
  };

  return { thread, activity, send, apply };
}
