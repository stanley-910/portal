/**
 * Real network check, never a fixture. Run from the repo root:
 * node --env-file-if-exists=.env.local scripts/smoke-flights.mts HKG PVG 2026-11-15
 * Only aggregate diagnostics are printed; no tokens, headers or raw error bodies.
 */
import { mkdir, writeFile } from "node:fs/promises";

const [origin = "HKG", destination = "PVG", suppliedDate] = process.argv.slice(2);
const later = new Date();
later.setUTCDate(later.getUTCDate() + 30);
const date = suppliedDate ?? later.toISOString().slice(0, 10);
if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)
  || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
  || new Date(date).toISOString().slice(0, 10) !== date) {
  throw new Error("Usage: smoke-flights.mts ORIGIN_IATA DESTINATION_IATA YYYY-MM-DD");
}
const report: Record<string, unknown> = {
  checkedAt: new Date().toISOString(), origin, destination, date,
  provider: "travelpayouts", dataFreshness: "cached", mocked: false,
};
const token = process.env.TRAVELPAYOUTS_TOKEN?.trim();
if (!token) {
  Object.assign(report, { status: "blocked", reason: "TRAVELPAYOUTS_TOKEN is not configured", networkAttempted: false });
  process.exitCode = 1;
} else {
  const params = new URLSearchParams({
    origin, destination, departure_at: date, one_way: "true", direct: "true", sorting: "price",
    currency: "usd", market: process.env.TRAVELPAYOUTS_MARKET || "us", limit: "5",
  });
  try {
    const response = await fetch(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${params}`, {
      headers: { "X-Access-Token": token }, signal: AbortSignal.timeout(15_000),
    });
    Object.assign(report, { networkAttempted: true, httpStatus: response.status });
    if (!response.ok) {
      Object.assign(report, { status: "failed", reason: "Provider returned a non-success HTTP status" });
      process.exitCode = 1;
    } else {
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || !("success" in payload) || payload.success !== true
        || !("data" in payload) || !Array.isArray(payload.data)) {
        Object.assign(report, { status: "failed", reason: "Unexpected provider response shape" });
        process.exitCode = 1;
      } else {
        Object.assign(report, { status: "ok", offerCount: payload.data.length,
          note: payload.data.length ? "Real API returned cached fares, not live availability" : "Real API succeeded but returned no cached fares" });
      }
    }
  } catch {
    // Don't print raw fetch errors: vendor/proxy error text can include credentials.
    Object.assign(report, { status: "failed", reason: "Network, timeout or JSON parsing failure", networkAttempted: true });
    process.exitCode = 1;
  }
}
const output = `${JSON.stringify(report, null, 2)}\n`;
console.log(output);
await mkdir(new URL("../.cache/", import.meta.url), { recursive: true });
await writeFile(new URL("../.cache/live-api-check.json", import.meta.url), output);
