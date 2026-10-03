"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref, type RefObject } from "react";

import { PipSprite } from "@/components/agent/pip-sprite";
import type { LatLng, TripGlobeHandle } from "@/components/trip-globe";
import { SAUCER_STAY_MS, type AgentMark } from "@/lib/agent/marks";
import { AGENT_NAME } from "@/lib/agent/types";

// Pip at work on the globe: its saucer (the globe draws it, trip-globe/ufo-model.ts) flies to whatever Pip is
// looking at, and the view follows it until someone moves the globe themselves.
// Pip makes its changes one at a time (agent/tools.ts): the saucer flies to where each goes and beams down as it gets
// there, the change lands and pops up over the place like a hit in a game, and the beam goes off as it moves on. Once
// Pip is done, the saucer flies off the screen. Positions are written to the DOM every frame.

/** A pop's whole life, rising and fading (matches the CSS animation). */
const POP_MS = 1800;
/** How long the saucer stays over a change after it pops, before flying to the next: as long as Pip waits. */
const HOLD_MS = SAUCER_STAY_MS;
/** The longest it waits to reach a place before popping anyway. */
const REACH_MS = 2500;
/** How long the saucer stays out after Pip stops, so it doesn't flicker between steps. */
const LINGER_MS = 1000;
/** How long the beam stays on after a change pops. */
const BEAM_MS = 350;
/** The longest it beams down at a place, waiting for a change that doesn't come. */
const BEAM_WAIT_MS = 1200;
/** Pops float this far above the saucer. */
const POP_RISE = 30;

export type PipSaucerHandle = {
  /** Plays what an edit changed: the saucer visits each place in turn and pops the change there. */
  play: (marks: AgentMark[]) => void;
};

type Pop = { id: number; mark: AgentMark };

type Props = {
  globe: RefObject<TripGlobeHandle | null>;
  /** Where Pip is looking now. */
  at: LatLng | null;
  /** Pip is working: the saucer stays out while this is on, at the last place it went. */
  busy: boolean;
  /** Pip is changing the trip: the saucer beams down at each place it reaches. */
  editing?: boolean;
  ref?: Ref<PipSaucerHandle>;
};

export function PipSaucer({ globe, at, busy, editing = false, ref }: Props) {
  const [pops, setPops] = useState<Pop[]>([]);
  const [out, setOut] = useState(false);
  // the viewer moved the globe while following: offer to follow again until the saucer goes
  const [lost, setLost] = useState(false);
  const [said, setSaid] = useState("");
  const beam = useRef<HTMLDivElement>(null);
  const popEls = useRef(new Map<number, HTMLDivElement>());
  // the latest props, for the frame loop
  const live = useRef({ at, busy, editing, pops });
  useEffect(() => {
    live.current = { at, busy, editing, pops };
    globe.current?.requestFrame();
  }, [at, busy, editing, pops, globe]);
  const queue = useRef<AgentMark[]>([]);

  useImperativeHandle(ref, () => ({ play: (marks) => { queue.current.push(...marks); globe.current?.requestFrame(); } }), [globe]);

  useEffect(() => {
    const handle = globe.current;
    if (!handle) return;
    let current: { mark: AgentMark; since: number; popped: number | null } | null = null;
    let place: LatLng | null = null;
    let sent = "";
    let shown = false;
    let lastBusy = -Infinity;
    let seq = 0;
    // the place the saucer last got to, when, and when a change last popped there
    let reached: { key: string; t: number; popped: number | null } | null = null;
    const born = new Map<number, number>();
    const send = (ll: LatLng | null) => {
      const key = ll ? `${ll.lat},${ll.lng}` : "";
      if (key === sent) return;
      sent = key;
      handle.setAgent(ll);
    };
    const follow = () => {
      setLost(false);
      handle.followAgent(true, () => setLost(true));
    };
    const stop = handle.onFrame(() => {
      const t = performance.now();
      const { at, busy, editing, pops } = live.current;
      if (!current && queue.current.length) current = { mark: queue.current.shift()!, since: t, popped: null };
      if (current || busy) lastBusy = t;
      place = current?.mark.at ?? (current ? place : at) ?? place;
      const nowOut = !!place && t - lastBusy < LINGER_MS;
      if (nowOut !== shown) {
        shown = nowOut;
        setOut(nowOut);
        if (nowOut) {
          if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setLost(true);
          else follow();
        }
        else {
          handle.followAgent(false);
          setLost(false);
          place = null;
        }
      }
      send(shown ? place : null);

      const spot = shown ? handle.agentSpot() : null;
      const key = place ? `${place.lat},${place.lng}` : "";
      if (!spot?.arrived) reached = null;
      else if (reached?.key !== key) reached = { key, t, popped: null };
      if (current && current.popped === null && (!current.mark.at || spot?.arrived || t - current.since > REACH_MS)) {
        current.popped = t;
        const pop = { id: ++seq, mark: current.mark };
        born.set(pop.id, t);
        setPops((list) => [...list, pop]);
        setSaid(current.mark.text);
        if (reached) reached.popped = t;
      }
      if (current?.popped != null && t - current.popped > HOLD_MS) current = null;

      // the saucer's beam: down as it gets where a change goes, off just after the change lands
      const seen = !!spot?.visible;
      if (beam.current) {
        const landing = editing && !!reached && t - reached.t < BEAM_WAIT_MS && (reached.popped === null || t - reached.popped < BEAM_MS);
        const popping = current?.popped != null && t - current.popped < BEAM_MS;
        const beaming = seen && !!spot && (landing || popping);
        beam.current.style.opacity = beaming ? "1" : "0";
        if (beaming) {
          const h = Math.max(0, spot.ground.y - spot.y);
          beam.current.style.transform = `translate(${Math.round(spot.x)}px, ${Math.round(spot.y)}px)`;
          beam.current.style.height = `${Math.round(h)}px`;
        }
      }
      // each pop rides on its place, as high over it as the saucer hovers
      const hover = spot ? spot.ground.y - spot.y : 0;
      let expired = false;
      for (const p of pops) {
        const el = popEls.current.get(p.id);
        if (t - (born.get(p.id) ?? t) > POP_MS) expired = true;
        if (!el) continue;
        const where = p.mark.at ? handle.project(p.mark.at) : spot && { x: spot.ground.x, y: spot.ground.y, visible: spot.visible };
        el.style.opacity = where?.visible ? "1" : "0";
        if (where) el.style.transform = `translate(${Math.round(where.x)}px, ${Math.round(where.y - hover - POP_RISE)}px)`;
      }
      if (current || queue.current.length || pops.length || (shown && t - lastBusy < LINGER_MS)) handle.requestFrame();
      if (expired) {
        const gone = new Set(pops.filter((p) => t - (born.get(p.id) ?? t) > POP_MS).map((p) => p.id));
        for (const id of gone) born.delete(id);
        setPops((list) => list.filter((p) => !gone.has(p.id)));
      }
    });
    return () => {
      stop();
      handle.setAgent(null);
      handle.followAgent(false);
    };
  }, [globe]);

  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div ref={beam} className="pip-beam" style={{ opacity: 0 }} />
        {pops.map((p) => (
          <div
            key={p.id}
            ref={(el) => {
              if (el) popEls.current.set(p.id, el);
              else popEls.current.delete(p.id);
            }}
            className="pip-pop"
            style={{ opacity: 0 }}
          >
            <span className="pip-pop-inner">{p.mark.text}</span>
          </div>
        ))}
      </div>
      {out && lost ? (
        <button
          type="button"
          className="pip-follow"
          onClick={() => {
            setLost(false);
            globe.current?.followAgent(true, () => setLost(true));
          }}
        >
          <PipSprite size={20} mood="idle" />
          Follow {AGENT_NAME}
        </button>
      ) : null}
      <output aria-live="polite" className="sr-only">
        {said}
      </output>
    </>
  );
}
