"use client";

import { useState } from "react";

import { startTripWithPip } from "@/app/t/actions";
import { Composer, Launcher } from "@/components/agent/agent-chat";
import { PipSprite } from "@/components/agent/pip-sprite";
import { RoundButton } from "@/components/paper-atlas";
import { AGENT_NAME } from "@/lib/agent/types";

// Pip on the home globe, before there's a trip: the first message starts a solo trip with it, and Pip answers
// there. Friends join from the trip's URL afterwards.

const NUDGE = "Tell me where you're going, or where your friends are. I'll plan the trip.";
const CHIPS = [
  "Train from Hong Kong to Shanghai on Friday",
  "I'm in Hong Kong, my friend's in Seoul. Where should we meet?",
  "Cheapest way from Taipei to Tokyo next week",
];

export function HomePip() {
  const [open, setOpen] = useState(false);
  if (!open) return <Launcher unread={false} nudge={NUDGE} onOpen={() => setOpen(true)} />;
  return (
    <section className="pip-panel" aria-label={`Plan a trip with ${AGENT_NAME}`}>
      <header className="pip-head">
        <PipSprite size={40} />
        <div className="min-w-0 flex-1">
          <p className="pip-head-name">{AGENT_NAME}</p>
          <p className="pip-head-sub">New trip · invite friends once it&apos;s started</p>
        </div>
        <RoundButton label="Minimise chat" onClick={() => setOpen(false)} />
      </header>
      <div className="pip-messages">
        <div className="pip-msg-agent">
          <PipSprite size={30} />
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
async function send(text: string) {
  try {
    await startTripWithPip(text);
  } catch (error) {
    if (isRedirect(error)) return;
    throw error;
  }
}

const isRedirect = (error: unknown) =>
  typeof error === "object" && error !== null && String((error as { digest?: unknown }).digest ?? "").startsWith("NEXT_REDIRECT");
