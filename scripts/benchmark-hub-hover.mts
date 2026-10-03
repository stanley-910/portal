/** Offline benchmark using the same distance scan as hover. No runtime dependency added. */
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const req = createRequire(import.meta.resolve("vitest/package.json"));
const { createServer } = await import(req.resolve("vite"));
const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  appType: "custom", logLevel: "error", server: { middlewareMode: true, watch: null } });
try {
  const { nearestPreviewHub } = await server.ssrLoadModule("/src/lib/transport/hubs/preview.ts");
  const points = Array.from({ length: 1000 }, (_, i) => ({ lat: -80 + ((i * 31) % 160), lng: -180 + ((i * 71) % 360) }));
  for (const p of points.slice(0, 100)) nearestPreviewHub(p);
  const times = points.map((p) => { const start = performance.now(); nearestPreviewHub(p); return performance.now() - start; }).sort((a, b) => a - b);
  const bytes = await readFile(new URL("../src/lib/transport/hubs/airports.json", import.meta.url));
  const minified = JSON.stringify(JSON.parse(bytes.toString()));
  console.log(JSON.stringify({ airports: JSON.parse(bytes.toString()).length, sourceBytes: bytes.length,
    minifiedBytes: Buffer.byteLength(minified), gzipBytes: gzipSync(minified).length,
    scans: times.length, medianMs: times[500], p95Ms: times[950], maxMs: times.at(-1), throttleMs: 80 }, null, 2));
} finally { await server.close(); }
