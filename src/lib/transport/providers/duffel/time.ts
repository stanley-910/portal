// Duffel writes segment times as the airport's local clock with no offset; our segments carry the offset.

const pad = (n: number) => String(n).padStart(2, "0");

/** Minutes the zone is ahead of UTC at that instant. Throws RangeError on an unknown zone. */
function offsetMinutes(zone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60_000);
}

/**
 * A local wall-clock time in `zone` as ISO 8601 with its offset, e.g. "2026-11-15T09:30:00+08:00". A time that already
 * has an offset passes through. Null when it can't be read.
 */
export function withOffset(local: string, zone: string | null | undefined): string | null {
  if (/(Z|[+-]\d{2}:\d{2})$/.test(local)) return Number.isFinite(Date.parse(local)) ? local : null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(local);
  if (!m || !zone) return null;
  const [, y, mo, d, h, mi, s = "00"] = m;
  const naive = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  try {
    // the offset at the wall-clock time, refined once so a time near a DST change lands on the right side
    const first = offsetMinutes(zone, naive);
    const off = offsetMinutes(zone, naive - first * 60_000);
    const abs = Math.abs(off);
    return `${y}-${mo}-${d}T${h}:${mi}:${s}${off < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  } catch {
    return null;
  }
}
