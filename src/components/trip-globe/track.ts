import { slerp, type Vec3 } from "./vec";

// Other people's cursors and planes arrive as presence updates. They're sent at most every 32 ms but don't arrive
// that way: several land at once, then nothing for a while (measured: most gaps under 5 ms, some over 500 ms).
// Drawing each as it lands makes them jump; easing toward the newest makes them lag and slow down. A track
// re-times updates to the pace they were sent at and draws a moment in the past, moving at a steady speed between
// the two updates either side of it, softened by a short ease for the stalls it can't wait out. Tuned on a recorded
// Liveblocks stream: against easing toward the newest update, frame-to-frame jitter halves, for about 0.1 s more lag.

/** How far behind a track draws, in seconds: enough to have the next update in hand through most bursts. */
export const TRACK_DELAY = 0.15;
/** The presence throttle (trip-room.tsx): how far apart updates were sent while someone moves. */
const TRACK_STEP = 0.032;
/** Arrivals further apart than this mean they'd stopped, so the next move starts from where they rested. */
const TRACK_GAP = 0.25;
/** Re-timed updates fall no further behind their arrival than this; past it, a burst plays back faster. */
const TRACK_LAG = 0.25;
/** How fast what's drawn closes on the track, per second: smooths over stalls longer than the delay. */
const TRACK_EASE = 30;
const KEEP = 16;

export class Track {
  private s: { t: number; v: Vec3 }[] = [];
  private arrived = -Infinity;
  private drawn: { t: number; v: Vec3 } | null = null;

  /** Adds where they are, arriving at time `t` (seconds, the same clock as `at`). A repeat is ignored. */
  push(v: Vec3, t: number) {
    const last = this.s.at(-1);
    if (last && last.v[0] === v[0] && last.v[1] === v[1] && last.v[2] === v[2]) return;
    let when = t;
    if (last && t - this.arrived > TRACK_GAP) {
      // without this, a move after a rest would be spread over the whole rest and jump
      this.s.push({ t: t - TRACK_STEP, v: last.v });
    } else if (last) {
      // a burst: space them as they were sent, without falling too far behind
      when = Math.min(Math.max(t, last.t + TRACK_STEP), t + TRACK_LAG);
      if (when <= last.t) when = last.t + 0.001;
    }
    this.arrived = t;
    this.s.push({ t: when, v });
    if (this.s.length > KEEP) this.s.splice(0, this.s.length - KEEP);
  }

  /** Where to draw them at time `t`, called once a frame. Null before the first update. */
  at(t: number): Vec3 | null {
    const target = this.sample(t - TRACK_DELAY);
    if (!target) return null;
    const d = this.drawn;
    const settled = d && target.every((x, i) => Math.abs(x - d.v[i]) < 1e-7);
    const v = settled ? target : d && t > d.t ? slerp(d.v, target, 1 - Math.exp(-(t - d.t) * TRACK_EASE)) : d && t === d.t ? d.v : target;
    this.drawn = { t, v };
    return v;
  }

  /** Where the re-timed updates put them at time `r`. */
  private sample(r: number): Vec3 | null {
    const s = this.s;
    if (!s.length) return null;
    let i = s.length - 1;
    while (i > 0 && s[i].t > r) i--;
    if (i === s.length - 1 || s[i].t > r) return s[i].v;
    const a = s[i], b = s[i + 1];
    return slerp(a.v, b.v, (r - a.t) / (b.t - a.t));
  }

  /** Keep rendering across the interpolation delay and stop once the final sample is reached. */
  active(t: number): boolean {
    const last = this.s.at(-1);
    if (!last) return false;
    return t < last.t + TRACK_DELAY || !this.drawn || last.v.some((x, i) => Math.abs(x - this.drawn!.v[i]) >= 1e-7);
  }

  /** Where they are now, ignoring the delay: for reduced motion. */
  latest(): Vec3 | null {
    return this.s.at(-1)?.v ?? null;
  }
}
