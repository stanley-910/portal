const OFFSET = "+08:00"; // Asia/Taipei, no DST
export const DAY = 1440;

/** [key, "HH:MM"] in running order → minutes from the run's start-day midnight; a smaller HH:MM rolls a day. */
export function timeline(stops: readonly (readonly [string, string])[]): Map<string, number> {
  const out = new Map<string, number>();
  let day = 0;
  let prev = -1;
  for (const [key, hhmm] of stops) {
    const m = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
    if (m < prev) day += DAY;
    prev = m;
    if (!out.has(key)) out.set(key, day + m);
  }
  return out;
}

/** `date` (YYYY-MM-DD) + `min` minutes, as local ISO with +08:00. */
export function at(date: string, min: number): string {
  return `${new Date(Date.parse(`${date}T00:00:00Z`) + min * 60_000).toISOString().slice(0, 19)}${OFFSET}`;
}

/**
 * q.date is the origin's local date; `days` is keyed on the run's start day.
 * Returns the minute offset to subtract (whole days before origin) or undefined if not running.
 */
export function runsOn(date: string, departMin: number, days: readonly number[] | undefined): number | undefined {
  const base = Math.floor(departMin / DAY) * DAY;
  const startWeekday = new Date(Date.parse(`${date}T00:00:00Z`) - base * 60_000).getUTCDay();
  return days && !days.includes(startWeekday) ? undefined : base;
}
