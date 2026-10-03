"use client";

import { shallow, useEventListener, useOthers, useRoom, useStorage } from "@liveblocks/react";
import { useCallback, useMemo, useState } from "react";

import { AGENT_ID, type ThreadMessage } from "@/lib/agent/types";

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
  return useMemo(
    () => (thread ?? []).map((m) => (m.state === "streaming" && streamed[m.id] ? { ...m, text: streamed[m.id].text } : m)),
    [thread, streamed],
  );
}

/**
 * How many replies Pip has finished, for the closed launcher's unread dot, without re-rendering per token. Null
 * until the room has loaded.
 */
export function usePipReplies(): number | null {
  return useStorage((root) => root.thread?.filter((m) => m.author.kind === "agent" && m.state !== "streaming").length ?? 0);
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
        body: JSON.stringify({ tripId, text }),
      });
      // asking Pip needs an account; guests get this instead of a reply
      if (res.status === 401) throw new Error(SIGN_IN_TO_ASK);
      if (!res.ok) throw new Error(`message failed: ${res.status}`);
    },
    [tripId],
  );
}
