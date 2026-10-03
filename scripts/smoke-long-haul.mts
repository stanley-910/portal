/** Real provider probes through application adapters. No booking, no passenger identity, no raw payload logging.
 * node --env-file-if-exists=.env.local scripts/smoke-long-haul.mts [YYYY-MM-DD]
 * A test Duffel token validates wiring only; cache emptiness never proves absent service.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
// Vite is Vitest's dependency under pnpm's isolated layout; use the installed test runner's resolver.
const requireFromVitest = createRequire(import.meta.resolve("vitest/package.json"));
const { createServer } = await import(requireFromVitest.resolve("vite"));

const date = process.argv[2] ?? new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
  || new Date(date).toISOString().slice(0, 10) !== date) throw new Error("Expected YYYY-MM-DD");
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root, configFile: false, appType: "custom", logLevel: "error",
  server: { middlewareMode: true, watch: null },
  resolve: { alias: {
    "@": fileURLToPath(new URL("../src", import.meta.url)),
    "server-only": fileURLToPath(new URL("../node_modules/server-only/empty.js", import.meta.url)),
  } },
});
try {
  const [{ HUBS }, { duffel }, { travelpayouts }] = await Promise.all([
    server.ssrLoadModule("/src/lib/transport/hubs/catalog.ts"),
    server.ssrLoadModule("/src/lib/transport/providers/duffel/index.ts"),
    server.ssrLoadModule("/src/lib/transport/providers/travelpayouts/index.ts"),
  ]);
  const reports = [];
  for (const [origin, destination] of [["HKG", "LHR"], ["HND", "SFO"], ["SIN", "SYD"]]) {
    const from = HUBS.find((hub: { iata?: string }) => hub.iata === origin);
    const to = HUBS.find((hub: { iata?: string }) => hub.iata === destination);
    const query = { from, to, date, modes: ["flight"], passengers: 1, currency: "USD" };
    for (const provider of [duffel, travelpayouts]) {
      const started = performance.now();
      const token = process.env[provider.id === "duffel" ? "DUFFEL_ACCESS_TOKEN" : "TRAVELPAYOUTS_TOKEN"]?.trim();
      const testMode = provider.id === "duffel" && !!token?.startsWith("duffel_test_");
      if (!token) {
        reports.push({ origin, destination, provider: provider.id, status: "NOT_CONFIGURED", networkAttempted: false });
        continue;
      }
      try {
        const offers = await provider.search(query, AbortSignal.timeout(provider.timeoutMs ?? 8000));
        reports.push({ origin, destination, provider: provider.id, testMode,
          status: "ok", networkAttempted: true, tookMs: Math.round(performance.now() - started),
          count: offers.length,
          kinds: [...new Set(offers.map((o: { kind: string }) => o.kind))],
          connections: offers.filter((o: { transfers?: number; segments: unknown[] }) => (o.transfers ?? o.segments.length - 1) > 0).length,
          sample: offers.slice(0, 2).map((o: { kind: string; segments: { depart: string; arrive: string }[] }) => ({
            kind: o.kind, depart: o.segments[0].depart, arrive: o.segments.at(-1)?.arrive,
          })),
          note: testMode ? "Synthetic Duffel test inventory; does not verify live airlines" : "Cached/modelled results are not live availability",
        });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "NETWORK_OR_TIMEOUT";
        reports.push({ origin, destination, provider: provider.id, testMode, status: code, networkAttempted: true });
      }
    }
  }
  const report = { checkedAt: new Date().toISOString(), date, reports };
  const output = JSON.stringify(report, null, 2) + "\n";
  console.log(output);
  await mkdir(new URL("../.cache/", import.meta.url), { recursive: true });
  await writeFile(new URL("../.cache/long-haul-check.json", import.meta.url), output);
} finally {
  await server.close();
}
