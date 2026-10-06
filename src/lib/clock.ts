// Clock times as people read them: "8:27 PM" by default, "20:27" for anyone who picked 24-hour in the profile menu
// (lib/clock-pref.ts). Times stay "HH:MM" in data; only what's shown changes.

export type ClockCycle = "12" | "24";

/** "20:27" as "8:27 PM", or as it is for `24`. Anything that isn't "HH:MM" comes back unchanged. */
export function formatClock(hhmm: string, cycle: ClockCycle = "12"): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  if (cycle === "24") return `${String(h).padStart(2, "0")}:${m[2]}`;
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** The local clock time an ISO timestamp was written in ("2026-11-15T20:27:00+08:00" → "8:27 PM"). */
export const clockOfIso = (iso: string, cycle: ClockCycle = "12") => formatClock(iso.slice(11, 16), cycle);
