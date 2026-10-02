// Browser integration check against a running app; no provider key required.
// pnpm exec playwright install chromium
// BASE_URL=http://localhost:3015 node scripts/smoke-globe.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.BASE_URL || "http://localhost:3000";
const viewport = { width: 1280, height: 900 };
const origin = { lat: 22.305, lng: 114.165 };
const destination = { lat: 31.23, lng: 121.47 };
// Initial camera projection. Reduced motion disables idle drift; these are real
// pointer clicks, not a call directly into the engine or the API.
function screenPoint({ lat, lng }) {
  const rad = Math.PI / 180;
  const vec = (lat, lon) => [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
  const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const target = vec(20 * rad, 108 * rad);
  const camera = target.map((n) => n * 3.4);
  const forward = target.map((n) => -n);
  const right = [Math.cos(108 * rad), 0, -Math.sin(108 * rad)];
  const up = cross(right, forward);
  const q = vec(lat * rad, lng * rad).map((n, i) => n - camera[i]);
  const { width: w, height: h } = viewport;
  const tan = Math.tan(Math.asin(1 / 3.4)) * (h / 2) / Math.min(w * 0.4, h * 0.37);
  const z = dot(q, forward);
  return { x: (dot(q, right) / (z * tan * w / h) / 2 + 0.5) * w,
    y: (0.5 - (dot(q, up) / (z * tan) + 0.09) / 2) * h };
}
const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  const errors = [];
  let searchRequests = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.url().includes("/api/transport/search?")) searchRequests++; });
  async function load() {
    await page.goto(url);
    await page.locator('canvas[aria-label="Globe"]').waitFor();
    await page.waitForTimeout(1000); // first camera frames, software WebGL setup, React hydration
    assert.equal(await page.getByText("This browser cannot draw the globe.").count(), 0);
  }
  async function plot() {
    const from = screenPoint(origin);
    const to = screenPoint(destination);
    await page.mouse.click(from.x, from.y);
    await page.waitForTimeout(1000); // allow the 250 ms simulation-time takeoff guard on software WebGL
    const airport = screenPoint({ lat: 22.308, lng: 113.918 });
    const searchesBeforeHover = searchRequests;
    await page.mouse.move(airport.x, airport.y);
    await page.waitForFunction(() => document.querySelector('[aria-label="Nearby transport hub"]')?.textContent.includes("HKG"));
    assert.equal(searchRequests, searchesBeforeHover, "Flying hover must not fetch routes");
    if (process.env.HOVER_SCREENSHOT_PATH) await page.screenshot({ path: process.env.HOVER_SCREENSHOT_PATH });
    await page.mouse.click(to.x, to.y);
  }
  await load();
  const airport = screenPoint({ lat: 22.308, lng: 113.918 });
  await page.mouse.move(airport.x, airport.y);
  await page.waitForFunction(() => document.querySelector('[aria-label="Nearby transport hub"]')?.textContent.includes("HKG"));
  const city = screenPoint(origin);
  await page.mouse.move(city.x, city.y);
  await page.waitForFunction(() => /Rail|Ferry/.test(document.querySelector('[aria-label="Nearby transport hub"]')?.textContent ?? ""));
  await page.mouse.move(1, 1);
  await page.waitForFunction(() => !document.querySelector('[aria-label="Nearby transport hub"]')?.textContent.trim());
  assert.equal(searchRequests, 0, "Idle hover must not fetch routes");
  console.log("PASS: local airport/surface hover previews, off-globe clearing, no search requests");
  const responsePromise = page.waitForResponse((response) => response.url().includes("/api/transport/search?"));
  await plot();
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  const requestUrl = new URL(response.url());
  const clicked = JSON.parse(requestUrl.searchParams.get("from"));
  assert.ok(Math.abs(clicked.lat - origin.lat) < 0.05);
  assert.ok(Math.abs(clicked.lng - origin.lng) < 0.05);
  assert.equal(clicked.iata, undefined);
  const data = await response.json();
  assert.ok(data.hubs.pairs.some((pair) => pair.mode === "train"));
  assert.ok(data.hubs.pairs.some((pair) => pair.from.hub.iata === "HKG"));
  await page.getByText("Nearby airports, stations and terminals").waitFor();
  assert.ok((await page.locator("body").innerText()).includes("Estimated"));
  if (data.offers.length) {
    const bounds = await page.getByText("Suggested option", { exact: true }).locator("..").evaluate((element) => ({
      visible: element.clientHeight, content: element.scrollHeight,
    }));
    assert.ok(bounds.content <= bounds.visible + 2, "Offer text must not collapse out of its scrolling card");
  }
  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH });
  console.log("PASS: real globe clicks → unsnapped coordinates → local API → hub/route results");

  // Preserve main's navbar and selectable date while keeping precise coordinates.
  await page.getByRole("button", { name: "Plan with friends", exact: true }).waitFor();
  await page.getByRole("button", { name: "Choose departure date", exact: true }).click();
  const later = new Date(`${requestUrl.searchParams.get("date")}T12:00:00Z`);
  later.setUTCDate(later.getUTCDate() + 7);
  const chosenDate = later.toISOString().slice(0, 10);
  const changedResponse = page.waitForResponse((response) => response.url().includes("/api/transport/search?")
    && new URL(response.url()).searchParams.get("date") === chosenDate);
  await page.getByLabel("Departure date", { exact: true }).fill(chosenDate);
  const changed = await changedResponse;
  assert.equal(changed.status(), 200);
  assert.deepEqual(JSON.parse(new URL(changed.url()).searchParams.get("from")), clicked);
  console.log("PASS: merged navbar and date picker; changing date preserves clicked coordinates");

  // A delayed result must not reappear after cancellation.
  await load();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/transport/search?**", async (route) => {
    await gate;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) }).catch(() => {});
  });
  await plot();
  await page.getByText("Finding hubs and routes…").waitFor();
  await page.getByRole("button", { name: "Cancel trip" }).click();
  release();
  await page.waitForTimeout(200);
  assert.equal(await page.getByText("Nearby airports, stations and terminals").count(), 0);
  assert.equal(await page.getByText("Finding hubs and routes…").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: canceled in-flight search cannot restore stale results; no page errors");
} finally {
  await browser.close();
}
