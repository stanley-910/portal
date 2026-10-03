"use client";

import { useEventListener, useOthers } from "@liveblocks/react";
import { useRef, type RefObject } from "react";

import { PipSaucer, type PipSaucerHandle } from "@/components/agent/pip-saucer";
import type { TripGlobeHandle } from "@/components/trip-globe";
import { AGENT_ID } from "@/lib/agent/types";

// Pip's cursor in a trip room (handoff §4) is its saucer: it goes where the presence the server sets for Pip says,
// and plays each edit's changes (the agent-marks broadcast) on everyone's globe at once.

export function PipCursor({ globe }: { globe: RefObject<TripGlobeHandle | null> }) {
  const presence = useOthers((list) => list.find((o) => o.id === AGENT_ID)?.presence ?? null);
  const saucer = useRef<PipSaucerHandle>(null);
  useEventListener(({ event }) => {
    if (event.type === "agent-marks") saucer.current?.play(event.marks);
  });
  return <PipSaucer ref={saucer} globe={globe} at={presence?.cursor ?? null} busy={!!presence?.activity} editing={presence?.activity === "editing the trip"} />;
}
