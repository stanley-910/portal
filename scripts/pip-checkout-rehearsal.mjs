// Drives Pip's checkout in headless Chromium against a deployed or local site in Stripe test mode: Ann (an account,
// since Pip only answers accounts) asks Pip to book, Pip quotes it, Ann says yes, Pip settles and posts the checkout card, both riders enter details
// in its modal, Ann holds her share on a new card in the embedded field, Bo (a guest) on Stripe's 3-D Secure test card,
// and the leg ends Booked. A trip from src/lib/booking/demo-seed.test.ts with SEED_ANN=<Ann's user id>:
//   ANN_EMAIL=… ANN_PASSWORD=… BASE_URL=https://portal-swart-mu.vercel.app node scripts/pip-checkout-rehearsal.mjs <TRIP_ID>
// SHOTS=<dir> saves screenshots. Never point it at the live site: it pays.
import { chromium } from "playwright";

const TRIP = process.argv[2];
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const S = process.env.SHOTS;
if (!TRIP || !process.env.ANN_EMAIL || !process.env.ANN_PASSWORD) throw new Error("usage: ANN_EMAIL=… ANN_PASSWORD=… node scripts/pip-checkout-rehearsal.mjs <TRIP_ID>");
if (/portal-live/.test(BASE)) throw new Error("Not on the live site: this rehearsal pays.");

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
// software WebGL: the trip page shows its plan only once the globe can draw
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = async (name, cookies = []) => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (cookies.length) await c.addCookies(cookies.map(([k, v]) => ({ name: k, value: v, domain: new URL(BASE).hostname, path: "/" })));
  const p = await c.newPage();
  p.on("console", (m) => m.type() === "error" && console.log(`[${name} console]`, m.text().slice(0, 200)));
  return p;
};
const shot = (p, name) => (S ? p.screenshot({ path: `${S}/${name}.png`, fullPage: true }).catch(() => {}) : null);

const ann = await page("Ann");
const bo = await page("Bo", [["portal_guest", "g_demoBo"], ["portal_name", "Bo"]]);
const card = (p) => p.locator(".pip-checkout").last();
const caption = async (p) => ((await card(p).locator(".pip-caption").first().textContent().catch(() => "")) ?? "").trim();
const bill = async (p) => ((await card(p).locator(".pip-bill").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();

const openPip = async (p) => {
  await p.getByRole("button", { name: "Open Pip" }).click({ timeout: 60000 });
  await p.locator(".pip-panel").waitFor({ timeout: 15000 });
};
const say = async (p, text) => {
  await p.getByRole("textbox", { name: "Message" }).fill(text);
  await p.getByRole("button", { name: "Send" }).click();
  log("Ann →", text);
};
const pipDone = async (p) => p.locator(".pip-step-running, .pip-thinking").count().then((n) => n === 0);

const details = async (p, given, born) => {
  await card(p).getByRole("button", { name: /Enter my details|Add my passport/ }).click({ timeout: 20000 });
  const d = p.locator(".pip-dialog");
  await d.waitFor();
  await d.locator("select[name=gender]").selectOption("f");
  await d.locator("input[name=givenName]").fill(given);
  await d.locator("input[name=familyName]").fill("Traveller");
  await d.locator("input[name=bornOn]").fill(born);
  await d.locator("input[name=phone]").fill("+85291234567");
  await d.locator("input[name=email]").fill(`${given.toLowerCase()}@example.com`);
  if (await d.locator("input[name=passportNumber]").count()) {
    await d.locator("input[name=passportNumber]").fill("E12345678");
    await d.locator("input[name=passportExpires]").fill("2032-01-01");
    await d.locator("select[name=passportCountry]").selectOption("HK");
  }
  await d.getByRole("button", { name: "Save and use" }).click();
  await d.waitFor({ state: "detached", timeout: 30000 });
  log(given, "details in:", await bill(p));
};

/** Clicks Stripe's test 3-D Secure "Complete" wherever its challenge frame is nested. */
const complete3ds = async (p) => {
  for (let i = 0; i < 40; i++) {
    for (const f of p.frames()) {
      const b = f.getByRole("button", { name: /complete/i });
      if (await b.count().catch(() => 0)) {
        await b.first().click();
        log("3-D Secure: approved");
        return true;
      }
    }
    await p.waitForTimeout(500);
  }
  return false;
};

const newCard = async (p, who, number, threeDs) => {
  await card(p).getByRole("button", { name: /Add a card/ }).click({ timeout: 30000 });
  const d = p.locator(".pip-dialog");
  await d.waitFor();
  const f = p.frameLocator(".pip-dialog iframe[title*='Secure payment']").first();
  await f.locator("input[name=number]").fill(number, { timeout: 30000 });
  await f.locator("input[name=expiry]").fill("12 / 34");
  await f.locator("input[name=cvc]").fill("123");
  if (await f.locator("select[name=country]").count()) await f.locator("select[name=country]").selectOption("HK").catch(() => {});
  if (await f.locator("input[name=postalCode]").count()) await f.locator("input[name=postalCode]").fill("00000").catch(() => {});
  await shot(p, `${who}-card`);
  await d.getByRole("button", { name: "Hold and save card" }).click();
  if (threeDs && !(await complete3ds(p))) throw new Error("no 3-D Secure challenge appeared");
  await d.waitFor({ state: "detached", timeout: 60000 });
  log(who, "card held:", await bill(p));
};

try {
  // Ann signs in with her password, as anyone would
  await ann.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await ann.locator("input[name=email]").fill(process.env.ANN_EMAIL);
  await ann.locator("input[name=password]").fill(process.env.ANN_PASSWORD);
  await ann.locator("input[name=password]").press("Enter");
  await ann.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  log("Ann signed in");

  await ann.goto(`${BASE}/t/${TRIP}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await bo.goto(`${BASE}/t/${TRIP}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await openPip(ann);
  await openPip(bo);

  await say(ann, "Book Bo and me on the flight we picked to Shanghai, please.");
  // Pip quotes first and books on Ann's yes; a moved fare comes back as another quote
  for (let tries = 0; tries < 3 && !(await card(ann).count()); tries++) {
    const t0 = Date.now();
    while (Date.now() - t0 < 120000 && !(await card(ann).count())) {
      await ann.waitForTimeout(2000);
      if (Date.now() - t0 > 15000 && (await pipDone(ann))) break;
    }
    if (await card(ann).count()) break;
    const reply = ((await ann.locator(".pip-msg-agent").last().textContent()) ?? "").replace(/\s+/g, " ");
    log("Pip:", reply.slice(0, 240));
    await say(ann, "Yes, go ahead at that price.");
  }
  await card(ann).waitFor({ timeout: 60000 });
  log("Pip:", ((await ann.locator(".pip-msg-agent").last().locator(".pip-text").allTextContents()) ?? []).join(" ").slice(0, 240));
  log("card:", await caption(ann), "|", await bill(ann));
  await shot(ann, "card-settled");

  await details(ann, "Ann", "1990-01-01");
  await card(bo).waitFor({ timeout: 30000 });
  await details(bo, "Bo", "1992-02-02");

  await newCard(ann, "Ann", "4242 4242 4242 4242", false);
  await newCard(bo, "Bo", "4000 0025 0000 3155", true);

  const t0 = Date.now();
  while (Date.now() - t0 < 90000 && !/Booked/.test(await caption(bo))) await bo.waitForTimeout(2000);
  log("final:", await caption(bo), "|", await bill(bo), "|", (await card(bo).textContent())?.match(/Reference \w+/)?.[0] ?? "no reference");
  await shot(bo, "final");
} catch (e) {
  log("FAILED", String(e.message).slice(0, 500));
  await shot(ann, "fail-ann");
  await shot(bo, "fail-bo");
}
await browser.close();
