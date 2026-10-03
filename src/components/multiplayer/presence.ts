"use client";

import { useOthers, useSelf } from "@liveblocks/react";
import { useMemo } from "react";

import { AGENT_ID } from "@/lib/agent/types";

/**
 * Who is in the trip's room right now: you and everyone connected, by member id. A member of the trip who isn't is
 * away, and their disc is drawn dashed. Null until the room says who you are.
 */
export function usePresentIds(): ReadonlySet<string> | null {
  const me = useSelf((self) => self.id);
  // joined into one string so the list re-renders only when someone comes or goes
  const others = useOthers((list) =>
    list
      .filter((o) => o.id && o.id !== AGENT_ID)
      .map((o) => o.id!)
      .sort()
      .join("\n"),
  );
  return useMemo(() => (me ? new Set([me, ...others.split("\n").filter(Boolean)]) : null), [me, others]);
}
