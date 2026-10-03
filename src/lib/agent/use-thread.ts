"use client";

import { shallow, useEventListener, useOthers, useRoom, useStorage } from "@liveblocks/react";
import { useCallback, useState } from "react";

import { AGENT_ID, type ThreadMessage } from "@/lib/agent/types";

// The trip's thread as the chat panel reads it. Messages live in Storage; Pip's text streams by broadcast
// until its reply is written, so this merges the two.

export function useThread(): ThreadMessage[] {
  const thread = useStorage((root) => root.thread ?? null);
  const [streamed, setStreamed] = useState<Record<string, string>>({});
  useEventListener(({ event }) => {
    if (event.type === "agent-text") setStreamed((s) => ({ ...s, [event.messageId]: event.text }));
  });
  return (thread ?? []).map((m) => (m.state === "streaming" && streamed[m.id] ? { ...m, text: streamed[m.id] } : m));
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

/** Posts to the thread; the server wakes Pip on an @mention or in a solo trip. */
export function useSendMessage() {
  const room = useRoom();
  const tripId = room.id.slice("trip:".length);
  return useCallback(
    async (text: string) => {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId, text }),
      });
      if (!res.ok) throw new Error(`message failed: ${res.status}`);
    },
    [tripId],
  );
}
