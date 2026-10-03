import { chromium } from "playwright";
const [BASE, TRIP] = process.argv.slice(2);
const b = await chromium.launch(); const c = await b.newContext();
await c.addCookies([{ name: "portal_guest", value: "g_demoAnn", domain: new URL(BASE).hostname, path: "/" }, { name: "portal_name", value: "Ann", domain: new URL(BASE).hostname, path: "/" }]);
const p = await c.newPage();
p.on("response", r => { if (r.request().resourceType()==="document") console.log("document", r.status(), r.url().slice(0,90), "x-nextjs-cache:", r.headers()["x-nextjs-cache"] ?? "-"); });
const r = await p.goto(`${BASE}/t/${TRIP}`, { waitUntil: "domcontentloaded", timeout: 90000 });
console.log("final", r.status(), "| body:", (await p.locator("body").innerText()).replace(/\s+/g," ").slice(0,120));
await b.close();
