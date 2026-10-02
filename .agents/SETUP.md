# SETUP — accounts, keys, local env

Do the **Day 1** column first: approvals take time and block live verification. Details and
sources per provider: `.agents/docs/api/<doc>.md` § Access.

## 1. Repo

```bash
git clone <repo> && cd portal
pnpm install
pnpm dev                         # http://localhost:3000
cp .env.example .env             # after C01 lands; never commit .env
```

Run agents: `.agents/EXECUTE.md` (paste prompt at top, say who you are).

## 2. Accounts and keys

| Provider | Who | Day 1 action | Gives | Env var(s) | Wait |
|---|---|---|---|---|---|
| Travelpayouts | Cata | Sign up app.travelpayouts.com; Profile → API token; copy marker (dashboard lower-left) + project id | token, marker, trs | `TRAVELPAYOUTS_TOKEN`, `TRAVELPAYOUTS_MARKER`, `TRAVELPAYOUTS_TRS` | none |
| 12Go affiliate | Cata | In Travelpayouts → Programs → join 12Go (or agent.12go.asia) | affiliate tag | `TRAVELPAYOUTS_MARKER` or `TWELVEGO_AFFILIATE_ID` | review; low-traffic sites may be declined. Untagged links still work |
| TDX (Taiwan) | Ahmet | **Not signing up — seeded (ADR-T04, ADR-B07).** Was: Taiwan mobile SMS or manual email review | — | `TDX_CLIENT_ID`, `TDX_CLIENT_SECRET` (unused, backlog) | — |
| data.go.kr (Korea) | Ahmet | **Not signing up — seeded (ADR-T05, ADR-B07).** Was: Korean national + 본인인증 | — | `DATA_GO_KR_SERVICE_KEY` (unused, backlog) | — |
| BusOnlineTicket affiliate | Ahmet | **Not signing up** — B05 seed ships untagged links (ADR-B03) | — | `BOT_REFERER_ID` (optional, unused) | — |
| Trip.com affiliate | Ahmet | **Not signing up** — T04 seed ships untagged links (ADR-T02) | — | `TRIPCOM_AFFILIATE_ID` (optional, unused) | — |
| GTFS (namtang, KTMB) | — | nothing — keyless | — | — | — |
| LTA DataMall | Ahmet | **Done** — key obtained, verified 2026-10-02 (BusStops + TrainServiceAlerts → 200) | AccountKey | `LTA_DATAMALL_ACCOUNT_KEY` | — |

Keys go in `.env` (dev) and Vercel → Project → Settings → Environment Variables (prod).
**Never** prefix with `NEXT_PUBLIC_` — that ships them to the browser.

## 3. Not available (do not sign up / do not build)

- **Rome2Rio API** — closed to new applications (ADR-T03).
- **12306** — no official API; no request-time calls (ADR-T02).
- **12Go API, BusOnlineTicket XML API** — partner-only; link-out instead (ADR-S01, ADR-B03).
- **TDX (Taiwan)** — signup needs Taiwan phone or manual review; THSR is seeded instead (ADR-T04).
- **Travelpayouts real-time Search API** — needs 50k MAU (ADR-F01).

## 4. Demo-day checklist

- [ ] Every key set in Vercel prod env.
- [ ] Search sample routes: `errors[]` has no `NOT_CONFIGURED` / `AUTH_FAILED`.
- [ ] `pnpm gtfs:build` run within 7 days; KTMB calendar not expired (ADR-B01).
- [ ] Supabase project woken, Liveblocks minutes left (`docs/research/free-tiers.md`).
