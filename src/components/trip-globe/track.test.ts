import { describe, expect, it } from "vitest";

import { Track, TRACK_DELAY } from "./track";
import { angle, D2R, vecOf, type Vec3 } from "./vec";

const at = (lngDeg: number) => vecOf(0, lngDeg * D2R);
const lngOf = (v: Vec3 | null) => Math.atan2(v![0], v![2]) / D2R;

/** Where the track draws on each 60 Hz frame from `from` to `to` seconds. */
const frames = (track: Track, from: number, to: number) => {
  const out: number[] = [];
  for (let t = from; t <= to; t += 1 / 60) out.push(lngOf(track.at(t)));
  return out;
};

describe("Track", () => {
  it("moves at a steady speed through updates that arrive in bursts", () => {
    const track = new Track();
    // sent every 32 ms, 1° apart, but arriving two or three at a time (as measured from Liveblocks)
    const arrivals = [0, 0, 0.064, 0.064, 0.064, 0.16, 0.16, 0.2, 0.26, 0.26];
    arrivals.forEach((t, i) => track.push(at(i), t));
    const steps = frames(track, 0.2, 0.45).map((x, i, xs) => (i ? x - xs[i - 1] : 0)).slice(1);
    // about 0.52° a frame at the pace they were sent: never jumps, never stands still, never goes backwards
    expect(Math.max(...steps)).toBeLessThan(0.75);
    expect(Math.min(...steps)).toBeGreaterThan(0);
  });

  it("holds the last place once it has caught up", () => {
    const track = new Track();
    track.push(at(0), 0);
    track.push(at(1), 0.032);
    expect(frames(track, 0, 2).at(-1)).toBeCloseTo(1, 5);
  });

  it("starts a move after a rest from where they rested, not partway along", () => {
    const track = new Track();
    track.push(at(0), 0);
    track.push(at(10), 3);
    const path = frames(track, 2.9, 3.6);
    // still resting until the move is due, then eased over several frames rather than one 10° jump
    expect(angle(vecOf(0, path[Math.round((3 - 0.032 + TRACK_DELAY - 2.9) * 60) - 1] * D2R), at(0))).toBeLessThan(1e-6);
    expect(Math.max(...path.map((x, i) => (i ? x - path[i - 1] : 0)))).toBeLessThan(4);
    expect(path.at(-1)).toBeCloseTo(10, 3);
  });

  it("doesn't fall far behind when a long burst lands at once", () => {
    const track = new Track();
    for (let i = 0; i < 12; i++) track.push(at(i), 1);
    // twelve updates at once would take 0.35 s at the sent pace; it plays them back faster past the lag allowed
    expect(frames(track, 1, 1 + 0.25 + TRACK_DELAY + 0.2).at(-1)).toBeCloseTo(11, 1);
  });

  it("ignores repeats, which arrive whenever anyone else's presence changes", () => {
    const track = new Track();
    track.push(at(0), 0);
    track.push(at(0), 2);
    track.push(at(4), 2.032);
    // the repeat didn't count as a fresh update, so the move after it starts from the rest
    expect(frames(track, 1.9, 2 + TRACK_DELAY).at(-1)).toBeCloseTo(0, 3);
  });
});
