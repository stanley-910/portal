/** Local-only production browser regression probe. Run with PORTAL_PROBE_URL=http://localhost:3107. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.PORTAL_PROBE_URL ?? "http://localhost:3107";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("This synthetic probe only runs on localhost.");
const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const errors: string[] = [];
const syntheticErrors: string[] = [];
const passed: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
let searches = 0;
let failHotel = false;
let delayHotel = false;
await page.route("**/api/transport/search?**", async (route) => {
  searches++;
  const params = new URL(route.request().url()).searchParams;
  const from = { ...JSON.parse(params.get("from")!), name: "Fixture origin", city: "Fixture origin", mode: "flight", country: "HK", code: "HKG" };
  const to = { ...JSON.parse(params.get("to")!), name: "Fixture destination", city: "Fixture destination", mode: "flight", country: "JP", code: "NRT" };
  const offers = [0, 1, 2].map((i) => ({ id: `fixture-${i}`, provider: "travelpayouts", mode: "flight", kind: "estimated", price: { amount: 100 + i * 20, currency: "USD" }, attribution: "Browser fixture", segments: [{ mode: "flight", carrier: `Fixture ${i}`, from, to, depart: `${params.get("date")}T08:00:00+08:00`, arrive: `${params.get("date")}T10:00:00+08:00`, durationMin: 120 + i * 10 }] }));
  await route.fulfill({ json: { offers, errors: [], tookMs: 1, estimates: [], offerPairs: Object.fromEntries(offers.map((o) => [o.id, ["fixture"]])), hubs: { pairs: [{ id: "fixture", from: { hub: from }, to: { hub: to } }] } } });
});
await page.route("**/api/hotels/search?**", async (route) => {
  if (delayHotel) await new Promise((r) => setTimeout(r, 700));
  if (failHotel) { failHotel = false; await route.fulfill({ status: 503, json: { error: "fixture" } }); return; }
  await route.fulfill({ json: { hotels: [{ id: "hotel-fixture", name: "Fixture Stay", city: "Tokyo", lat: 35, lng: 139, kind: "hotel", stars: 4, bedsPerRoom: 2, pricePerNight: { amount: 90, currency: "USD" }, freshness: "estimated", distanceKm: 1, score: 8, rooms: 1, totalPrice: { amount: 90, currency: "USD" }, nights: 1 }] } });
});
try {
  await page.goto(base);
  await page.waitForTimeout(2000);
  await page.mouse.click(650, 450);
  await page.waitForTimeout(200);
  await page.mouse.move(750, 500, { steps: 8 });
  await page.mouse.click(750, 500);
  await page.waitForTimeout(200);
  await page.mouse.move(830, 390, { steps: 8 });
  await page.mouse.click(830, 390);
  await page.waitForTimeout(100);
  await page.mouse.click(830, 390);
  await page.mouse.move(0, 899);
  const card = page.locator("section.ts");
  await card.waitFor({ state: "visible" });
  await card.getByText("Leg 1 of 2", { exact: true }).waitFor();
  await card.locator("button.ts-row").nth(1).click();
  const selection = await card.locator('button.ts-row[aria-pressed="true"]').innerText();
  await card.getByRole("button", { name: "Next leg", exact: true }).click();
  await card.getByText("Leg 2 of 2", { exact: true }).waitFor();
  await card.locator("button.ts-row").first().waitFor();
  const beforeBack = searches;
  await card.getByRole("button", { name: "Back", exact: true }).click();
  await card.getByText("Leg 1 of 2", { exact: true }).waitFor();
  assert.equal(await card.locator('button.ts-row[aria-pressed="true"]').innerText(), selection);
  await page.waitForTimeout(150);
  assert.equal(searches, beforeBack);
  passed.push("Back retains the selected fare without another identical nonlive search");

  await card.getByRole("tab", { name: "Hotels", exact: true }).click();
  await card.getByText("Fixture Stay", { exact: true }).waitFor();
  await card.locator(".hs-fields select").first().selectOption("3");
  await card.getByRole("tab", { name: "Best", exact: true }).click();
  await card.getByRole("tab", { name: "Hotels", exact: true }).click();
  assert.equal(await card.locator(".hs-fields select").first().inputValue(), "3");
  passed.push("Hotel filters survive leaving and reopening the tab");
  delayHotel = true; failHotel = true;
  await card.locator(".hs-fields select").first().selectOption("4");
  await card.locator(".hs .ts-row-ghost").first().waitFor();
  await card.getByRole("button", { name: "Try again", exact: true }).click();
  await card.getByText("Fixture Stay", { exact: true }).waitFor();
  passed.push("Refined hotel queries show loading and recover through Retry");

  await page.evaluate(() => window.history.pushState(null, "", "/?auth=signup"));
  const dialog = page.getByRole("dialog"); await dialog.waitFor();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement) || document.activeElement === document.body), true);
  }
  await dialog.getByRole("button", { name: "Close", exact: true }).focus();
  await page.keyboard.press("/");
  assert.equal(await page.locator(".pn-search-panel").count(), 0);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await card.isVisible(), true);
  passed.push("Auth excludes background focus/shortcuts and Escape preserves the landed ticket");

  await page.getByRole("button", { name: "Open Pip", exact: true }).click();
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("unsent draft");
  await page.getByRole("button", { name: "Minimise chat", exact: true }).click();
  await page.getByRole("button", { name: "Open Pip", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "unsent draft");
  passed.push("Pip minimization retains the unsent draft");
  // Client-only synthetic identity exercises chat controls; server authorization is never bypassed or invoked.
  const pipPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  pipPage.on("pageerror", (error) => syntheticErrors.push(error.message));
  await pipPage.route(base + "/", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const guest = '\\"person\\":null';
    const fixture = JSON.stringify({ id: "fixture", name: null, account: true, email: null, nationalities: [], color: null }).replaceAll('"', '\\"');
    assert.equal(body.includes(guest), true, "local fixture identity target exists");
    await route.fulfill({ response, body: body.replace(guest, '\\"person\\":' + fixture) });
  });
  await pipPage.route("**/api/transport/search?**", (route) => route.abort());
  await pipPage.addInitScript(() => {
    const original = window.fetch;
    const stats = { requests: 0, cancelled: 0 };
    Object.assign(window, { flowPipStats: stats });
    window.fetch = async (input, init) => {
      if (String(input) !== "/api/pip") return original(input, init);
      const request = ++stats.requests;
      let timer: ReturnType<typeof setTimeout>;
      return new Response(new ReadableStream({
        start(controller) {
          const send = (event: unknown) => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n"));
          send({ t: "text", d: `Fixture reply ${request}` });
          timer = setTimeout(() => {
            if (request === 1 || request === 3) send({ t: "trip", legs: [{ from: { name: "Hong Kong", lat: 22.31, lng: 114.17, hub: null, code: null }, to: { name: "Tokyo", lat: 35.67, lng: 139.7, hub: null, code: null }, date: "2027-01-15" }] });
            if (request === 3) { controller.error(new Error("Fixture disconnect after edit")); return; }
            send({ t: "done" }); controller.close();
          }, request === 1 ? 1800 : 600);
        },
        cancel() { clearTimeout(timer); stats.cancelled++; },
      }), { headers: { "content-type": "application/x-ndjson" } });
    };
  });
  await pipPage.goto(base);
  await pipPage.getByRole("button", { name: "Open Pip", exact: true }).click();
  const composer = pipPage.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill("first request");
  await pipPage.getByRole("button", { name: "Send", exact: true }).click();
  await pipPage.getByRole("button", { name: "Stop reply", exact: true }).waitFor();
  await composer.fill("second request");
  assert.equal(await pipPage.getByRole("button", { name: "Send", exact: true }).isDisabled(), true);
  await pipPage.getByRole("button", { name: "Stop reply", exact: true }).click();
  await pipPage.getByText("Reply interrupted.", { exact: false }).waitFor();
  await pipPage.waitForTimeout(1900);
  assert.equal(await pipPage.locator("section.ts").count(), 0, "stopped late trip event cannot mutate the globe");
  await pipPage.getByRole("button", { name: "Send", exact: true }).click();
  await pipPage.getByText("Fixture reply 2", { exact: true }).waitFor();
  await pipPage.getByRole("button", { name: "Stop reply", exact: true }).waitFor({ state: "detached" });
  await composer.fill("apply then lose reply");
  await pipPage.getByRole("button", { name: "Send", exact: true }).click();
  await pipPage.getByText("Trip updated. Send a follow-up to continue the interrupted reply.", { exact: true }).waitFor();
  assert.equal(await pipPage.locator(".pip-msg-agent").last().getByRole("button", { name: "Try again", exact: true }).count(), 0);
  const stats = await pipPage.evaluate(() => (window as unknown as { flowPipStats: { requests: number; cancelled: number } }).flowPipStats);
  assert.equal(stats.requests, 3); assert.ok(stats.cancelled >= 1);
  await pipPage.close();
  passed.push("Synthetic solo Pip stream serializes prompts, Stop cancels late plan events, and the next prompt completes");
  passed.push("A disconnected reply that already edited the trip cannot repeat the original edit through Retry");
  assert.deepEqual(errors, []);
  assert.deepEqual(syntheticErrors, []);
  const result = { environment: "Local production browser, synthetic read-only transport/hotel responses; no auth or payment submitted", passed, searches, errors, syntheticErrors, syntheticFixtureNote: "A synthetic client account replaces guest RSC data only in the test browser, retaining the same null display name to keep SSR markup consistent. No server auth or payment is called." };
  writeFileSync(process.env.FLOW_PROBE_OUTPUT ?? "docs/performance/flow-regressions.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
