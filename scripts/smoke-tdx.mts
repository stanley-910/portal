// Read-only access probe, not a booking or full mapper test. No raw errors/tokens logged.
// node --env-file-if-exists=.env.local scripts/smoke-tdx.mts 2026-10-14
import { mkdirSync, writeFileSync } from "node:fs";
const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Pass a valid YYYY-MM-DD date");
const report: Record<string, unknown> = { provider: "tdx", date, checkedAt: new Date().toISOString(), kind: "timetable", seatsChecked: false, pricesChecked: false, networkAttempted: false };
const clientId = process.env.TDX_CLIENT_ID?.trim(), clientSecret = process.env.TDX_CLIENT_SECRET?.trim();
if (!clientId || !clientSecret) {
  report.status = "NOT_CONFIGURED"; process.exitCode = 1;
} else {
  const signal = AbortSignal.timeout(8_000);
  try {
    report.networkAttempted = true;
    const auth = await fetch("https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token", {
      method: "POST", signal, headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    });
    if (!auth.ok) { report.authHttpStatus = auth.status; throw new Error("auth"); }
    const token: unknown = await auth.json();
    if (!token || typeof token !== "object" || !("access_token" in token) || typeof token.access_token !== "string") throw new Error("auth shape");
    const response = await fetch(`https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/TrainDate/${date}?$format=JSON&$top=1000`, {
      signal, headers: { authorization: `Bearer ${token.access_token}` },
    });
    report.httpStatus = response.status;
    if (!response.ok) throw new Error("data");
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || !rows.every((r) => r && r.TrainDate === date && Array.isArray(r.StopTimes))) throw new Error("shape");
    report.status = "OK"; report.trains = rows.length;
  } catch {
    report.status = "FAILED"; process.exitCode = 1;
  }
}
mkdirSync(new URL("../.cache/", import.meta.url), { recursive: true });
writeFileSync(new URL("../.cache/tdx-smoke.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
