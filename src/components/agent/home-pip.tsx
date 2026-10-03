"use client";

import { useState } from "react";

import { startTripWithPip } from "@/app/t/actions";
import { Composer, Launcher, PipClose } from "@/components/agent/agent-chat";
import { setPendingAction, useOpenAuth } from "@/components/auth/links";
import { PipSprite } from "@/components/agent/pip-sprite";
import { AGENT_NAME } from "@/lib/agent/types";

// Pip on the home globe, before there's a trip: the first message starts a solo trip with it, and Pip answers
// there. Friends join from the trip's URL afterwards.

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

/** `account`: Pip needs one. A guest's first message waits behind sign-in and goes out once they're in. */
export function HomePip({ account }: { account: boolean }) {
  const [open, setOpen] = useState(false);
  const openAuth = useOpenAuth();
  const send = async (text: string) => {
    if (account) return startTrip(text);
    setPendingAction({ type: "pip", text });
    openAuth("signup");
  };
  if (!open) return <Launcher unread={false} nudges={NUDGES} onOpen={() => setOpen(true)} />;
  return (
    <section className="pip-panel" aria-label={`Plan a trip with ${AGENT_NAME}`}>
      <header className="pip-head">
        <PipSprite size={40} />
        <div className="min-w-0 flex-1">
          <p className="pip-head-name">{AGENT_NAME}</p>
          <p className="pip-head-sub">New trip</p>
        </div>
        <PipClose onClick={() => setOpen(false)} />
      </header>
      <div className="pip-messages">
        <div className="pip-msg-agent">
          <div className="pip-msg-agent-body">
            <span className="pip-label">{AGENT_NAME}</span>
            <p className="pip-text">Where are you headed? I&apos;ll start a trip, add the legs and find the routes. Bring friends in later with the trip&apos;s link.</p>
          </div>
        </div>
      </div>
      <Composer chips={CHIPS} send={send} placeholder={`Tell ${AGENT_NAME} where you're going`} />
    </section>
  );
}

/** Starts the trip; the action redirects into it, which is not a failure. */
export async function startTrip(text: string) {
  try {
    await startTripWithPip(text);
  } catch (error) {
    if (isRedirect(error)) return;
    throw error;
  }
}

const isRedirect = (error: unknown) =>
  typeof error === "object" && error !== null && String((error as { digest?: unknown }).digest ?? "").startsWith("NEXT_REDIRECT");
