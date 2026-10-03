/** Local-only timings visible in DevTools. Names never contain user or trip data. */
export type PortalTiming = "globe-ready" | "fare-first" | "fare-complete" | "pip-first-text" | "plan-applied" | "save" | "checkout";
export function recordTiming(name: PortalTiming, start = 0) {
  if (typeof window === "undefined" || typeof performance.measure !== "function") return;
  try {
    const key = `portal:${name}`;
    // One current sample per operation name keeps the Performance Timeline bounded.
    performance.clearMeasures(key);
    performance.measure(key, { start, end: performance.now() });
  } catch { /* Older engines may not support User Timing Level 3. */ }
}
