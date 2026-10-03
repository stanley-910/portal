// Drives the booking rehearsal in headless Chromium: Ann settles, both riders enter details, both pay through Stripe
// Checkout with the 4242 test card, and the leg ends Booked. Needs the dev server, `stripe listen` and a trip from
// src/lib/booking/demo-seed.test.ts:  node scripts/checkout-rehearsal.mjs <TRIP_ID>   (SKIP_SETTLE=1 resumes at paying, BASE_URL=https://… for a tunnel)
import { chromium } from "playwright";
const TRIP = process.argv[2]; const BASE = process.env.BASE_URL ?? "http://localhost:3000"; const url = `${BASE}/t/${TRIP}?book=leg1`; // the leg open, as the Stripe return lands it
const S = process.env.SHOTS;
// software WebGL: the trip page shows its plan only once the globe can draw
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctxFor = async (id, name) => { const c = await browser.newContext(); await c.addCookies([{ name: "portal_guest", value: id, domain: new URL(BASE).hostname, path: "/" }, { name: "portal_name", value: name, domain: new URL(BASE).hostname, path: "/" }]); const p = await c.newPage(); p.on("console", m => { if (m.type()==="error") console.log(`[${name} console]`, m.text().slice(0,160)); }); return p; };
const ann = await ctxFor("g_demoAnn", "Ann"); const bo = await ctxFor("g_demoBo", "Bo");
const log = (...a) => console.log(new Date().toISOString().slice(11,19), ...a);
const status = async (p) => (await p.locator(".tp-book-head").textContent().catch(()=>"(no booking head)"))?.trim();
const details = async (p, given, born) => {
  await p.getByRole("button", { name: "Enter my details" }).click();
  await p.selectOption("select[name=gender]", "f");
  await p.fill("input[name=givenName]", given); await p.fill("input[name=familyName]", "Traveller");
  await p.fill("input[name=bornOn]", born); await p.fill("input[name=phone]", "+85291234567"); await p.fill("input[name=email]", `${given.toLowerCase()}@example.com`);
  if (await p.locator("input[name=passportNumber]").count()) { await p.fill("input[name=passportNumber]", "E12345678"); await p.fill("input[name=passportExpires]", "2032-01-01"); await p.selectOption("select[name=passportCountry]", "HK"); }
  await p.locator(".tp-book form button[type=submit], .tp-book button:has-text('Save')").first().click();
  await p.waitForTimeout(4000);
};
const payStripe = async (p, who) => {
  const btn = p.getByRole("button", { name: /Pay my share/ });
  await btn.waitFor({ timeout: 15000 });
  log(who, "button:", await btn.textContent());
  await Promise.all([p.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 }), btn.click()]);
  log(who, "on Stripe:", p.url().slice(0, 60));
  const cardRadio = p.getByRole("radio", { name: /^Card/ }); if (await cardRadio.count()) await cardRadio.first().check();
  await p.waitForSelector("#cardNumber", { timeout: 30000 });
  if (await p.locator("#email").count()) await p.fill("#email", `${who.toLowerCase()}@example.com`);
  await p.fill("#cardNumber", "4242 4242 4242 4242"); await p.fill("#cardExpiry", "12 / 34"); await p.fill("#cardCvc", "123");
  if (await p.locator("#billingName").count()) await p.fill("#billingName", `${who} Traveller`);
  if (await p.locator("#billingCountry").count()) await p.selectOption("#billingCountry", "HK").catch(()=>{});
  if (await p.locator("#billingPostalCode").count()) await p.fill("#billingPostalCode", "000000").catch(()=>{});
  if (S) await p.screenshot({ path: `${S}/${who}-stripe.png` });
  await p.locator(".SubmitButton").click();
  await p.waitForURL((u) => u.origin === BASE && u.searchParams.get("book") === "leg1", { timeout: 60000 });
  log(who, "back at", p.url());
  await p.waitForTimeout(3000);
};
try {
  await ann.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 }); await bo.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  if (process.env.SKIP_SETTLE) { await ann.locator(".tp-book").waitFor({ timeout: 30000 }); log("resuming:", await status(ann)); } else {
  await ann.getByRole("button", { name: "Settle and book" }).waitFor({ timeout: 30000 });
  log("ann settling"); await ann.getByRole("button", { name: "Settle and book" }).click();
  // the group price may differ a little from the single-seat quote: accept the prompt, then wait for the booking panel
  const accept = ann.getByRole("button", { name: /^Continue$/ });
  await Promise.race([accept.waitFor({ timeout: 30000 }), ann.locator(".tp-book").waitFor({ timeout: 30000 })]);
  if (await accept.count()) { log("accepting price change:", (await ann.locator(".tp-book-row, .tp-price").first().textContent().catch(()=>""))?.trim().slice(0, 60)); await accept.click(); }
  await ann.locator(".tp-book").waitFor({ timeout: 30000 });
  log("after settle:", await status(ann));
  await details(ann, "Ann", "1990-01-01"); log("ann details:", await status(ann));
  await details(bo, "Bo", "1992-02-02"); log("bo details:", await status(bo));
  }
  if (S) await ann.screenshot({ path: `${S}/paying.png`, fullPage: true });
  await payStripe(ann, "Ann"); log("after ann pays:", await status(ann));
  await payStripe(bo, "Bo"); log("after bo pays:", await status(bo));
  await bo.waitForTimeout(5000);
  log("final (bo):", await status(bo), "|", (await bo.locator(".tp-seats").textContent())?.replace(/\s+/g," "), "|", await bo.locator(".tp-book-ref").textContent().catch(()=>"no ref"));
  if (S) await bo.screenshot({ path: `${S}/booked.png`, fullPage: true });
} catch (e) { log("FAILED", e.message.slice(0, 400)); if (S) { await ann.screenshot({ path: `${S}/fail-ann.png`, fullPage: true }).catch(()=>{}); await bo.screenshot({ path: `${S}/fail-bo.png`, fullPage: true }).catch(()=>{}); } }
await browser.close();
