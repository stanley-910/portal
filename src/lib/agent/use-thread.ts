"use client";

import { shallow, useEventListener, useOthers, useRoom, useStorage } from "@liveblocks/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { abandoned, LOST_REPLY, QUEUE_BEAT_MS, QUEUED_STALE_MS, waiting } from "@/lib/agent/queue";
import { AGENT_ID, isObservation, type ThreadMessage } from "@/lib/agent/types";
import { readCurrencyPref } from "@/lib/currency-pref";

// The trip's thread as the chat panel reads it. Messages live in Storage; Pip's text streams by broadcast
// until its reply is written, so this merges the two. Only the streaming message is a new object per token; the
// rest keep their Storage snapshots, so memoised rows skip re-rendering.

export function useThread(): ThreadMessage[] {
  const thread = useStorage((root) => root.thread ?? null);
  const [streamed, setStreamed] = useState<Record<string, { seq: number; text: string }>>({});
  useEventListener(({ event }) => {
    if (event.type !== "agent-text") return;
    setStreamed((s) => ((s[event.messageId]?.seq ?? -1) >= event.seq ? s : { ...s, [event.messageId]: { seq: event.seq, text: event.text } }));
  });
  // a reply whose request died reads as failed, even if no later message comes along to mark it; judged a beat
  // late, as this clock may not agree with the server's
  const [now, setNow] = useState(() => Date.now());
  const pending = thread?.some(waiting) ?? false;
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => setNow(Date.now()), QUEUE_BEAT_MS);
    return () => clearInterval(id);
  }, [pending]);
  return useMemo(
    () =>
      (thread ?? []).map((m): ThreadMessage => {
        if (waiting(m) && abandoned(m, now - QUEUED_STALE_MS)) return { ...m, text: m.text || LOST_REPLY, state: "failed" };
        return m.state === "streaming" && streamed[m.id] ? { ...m, text: streamed[m.id].text } : m;
      }),
    [thread, streamed, now],
  );
}

/**
 * How many replies Pip has finished, for the closed launcher's unread dot, without re-rendering per token. Null
 * until the room has loaded.
 */
export function usePipReplies(): number | null {
  // queued and streaming replies aren't finished yet; observations aren't replies
  return useStorage((root) => root.thread?.filter((m) => m.author.kind === "agent" && (m.state === "done" || m.state === "failed") && !isObservation(m)).length ?? 0);
}

/** How many of Pip's observations are still open: noticed, and nobody has answered them yet. */
export function usePipObservations(): number | null {
  return useStorage((root) => root.thread?.filter((m) => isObservation(m) && m.cards.some((c) => c.type === "fix" && c.state === "open")).length ?? 0);
}

/** What Pip is doing right now, from the presence the server sets for it; null when it's idle or away. */
export function usePipActivity(): string | null {
  const others = useOthers((list) => list.filter((o) => o.id === AGENT_ID).map((o) => o.presence.activity ?? null), shallow);
  return others.find(Boolean) ?? null;
}

/** Whether Pip has a run going in this room. */
export function usePipBusy(): boolean {
  return useStorage((root) => !!root.agentRun && root.agentRun.until > Date.now()) ?? false;
}

export const SIGN_IN_TO_ASK = "SIGN_IN_TO_ASK";

/** Posts to the thread; every message wakes Pip. */
export function useSendMessage() {
  const room = useRoom();
  const tripId = room.id.slice("trip:".length);
  return useCallback(
    async (text: string) => {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId, text, currency: readCurrencyPref() }),
      });
      // asking Pip needs an account; guests get this instead of a reply
      if (res.status === 401) throw new Error(SIGN_IN_TO_ASK);
      if (!res.ok) throw new Error(`message failed: ${res.status}`);
      return ((await res.json()) as { messageId: string }).messageId;
    },
    [tripId],
  );
}
