/** Read-only app-route smoke; starts no bookings and prints no credentials or raw payloads.
 * BASE_URL=http://localhost:3112 node scripts/smoke-transport-review.mts
 */
import assert from "node:assert/strict";
const base = process.env.BASE_URL ?? "http://localhost:3000";
const cases: Array<{ name: string; from: number[]; to: number[]; mode: string; provider: string; destinationId?: string; date?: string }> = [
  { name: "HK–Shanghai cached schedules", from: [22.305, 114.165], to: [31.23, 121.47], mode: "train", provider: "rail-cache", date: "2026-10-04" },
  { name: "HK–Shanghai", from: [22.305, 114.165], to: [31.23, 121.47], mode: "train", provider: "china-rail" },
  { name: "Hanoi–Saigon", from: [21.0242, 105.8408], to: [10.7822, 106.6772], mode: "train", provider: "vietnam-rail" },
  { name: "HarbourFront–Batam", from: [1.264, 103.82], to: [1.130, 104.055], mode: "ferry", provider: "official-ferries" },
  { name: "Batam–HarbourFront", from: [1.130, 104.055], to: [1.264, 103.82], mode: "ferry", provider: "official-ferries" },
  { name: "Tanah Merah–Bintan", destinationId: "ferry:BINTAN-BBT", from: [1.314, 103.988], to: [1.1605, 104.3202], mode: "ferry", provider: "official-ferries" },
  { name: "Busan–Hakata", from: [35.116, 129.049], to: [33.61, 130.399], mode: "ferry", provider: "official-ferries" },
  { name: "Taipei–Zuoying", from: [25.048, 121.517], to: [22.687, 120.309], mode: "train", provider: "tdx" },
  { name: "HK–London", from: [22.305, 114.165], to: [51.5, -0.1], mode: "flight", provider: "travelpayouts" },
];
const reports = await Promise.allSettled(cases.map(async (c) => {
  const url = new URL("/api/transport/search", base);
  url.search = new URLSearchParams({
    from: JSON.stringify({ name: "Origin", lat: c.from[0], lng: c.from[1] }),
    to: JSON.stringify({ name: "Destination", lat: c.to[0], lng: c.to[1] }),
    date: c.date ?? "2026-11-15", modes: c.mode, currency: "USD", resolve: "hubs",
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, c.name);
  const data = await response.json() as { offers: Array<{ provider: string; kind: string; attribution?: string; price?: unknown; segments: Array<{ depart: string; arrive: string; to: { id?: string } }> }> };
  const offers = data.offers.filter((o) => o.provider === c.provider && (!c.destinationId || o.segments.at(-1)?.to.id === c.destinationId));
  assert.ok(offers.length, `${c.name}: expected ${c.provider} results`);
  assert.ok(offers.every((o) => o.attribution && o.kind !== "live"), `${c.name}: sourced non-live data required`);
  if (["china-rail", "vietnam-rail", "official-ferries", "rail-cache"].includes(c.provider)) assert.ok(offers.every((o) => !o.price), `${c.name}: no invented fare`);
  return { route: c.name, provider: c.provider, offers: offers.length, kinds: [...new Set(offers.map((o) => o.kind))], sampleArrival: offers[0].segments.at(-1)?.arrive };
}));
for (const report of reports) {
  if (report.status === "fulfilled") console.log(report.value);
  else { console.error(String(report.reason)); process.exitCode = 1; }
}
