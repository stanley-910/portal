# SETUP — accounts, keys, local env

Do the **Day 1** column first: approvals take time and block live verification. Details and
sources per provider: `.agents/docs/api/<doc>.md` § Access.

## 1. Repo

```bash
git clone <repo> && cd portal
pnpm install
pnpm dev                         # http://localhost:3000
cp .env.example .env.local       # after C01 lands; never commit .env.local
```

Run agents: `.agents/EXECUTE.md` (paste prompt at top, say who you are).

## 2. Accounts and keys

| Provider | Who | Day 1 action | Gives | Env var(s) | Wait |
|---|---|---|---|---|---|
| Travelpayouts | Cata | Sign up app.travelpayouts.com; Profile → API token; copy marker (dashboard lower-left) + project id | token, marker, trs | `TRAVELPAYOUTS_TOKEN`, `TRAVELPAYOUTS_MARKER`, `TRAVELPAYOUTS_TRS` | none |
| 12Go affiliate | Cata | In Travelpayouts → Programs → join 12Go (or agent.12go.asia) | affiliate tag | `TRAVELPAYOUTS_MARKER` or `TWELVEGO_AFFILIATE_ID` | review; low-traffic sites may be declined. Untagged links still work |
| data.go.kr (Korea) | Ahmet | **Needs Korean national + 본인인증.** Find someone with Korean phone/i-PIN; apply for TrainInfo, ExpBusInfo, SuburbsBusInfo (3 applications) | serviceKey | `DATA_GO_KR_SERVICE_KEY` — use the **Decoding** key | auto-approve once account exists |
| BusOnlineTicket affiliate | Ahmet | Apply with live site URL (Vercel deploy) | `refererid` | `BOT_REFERER_ID` | manual |
| Trip.com affiliate | Ahmet | Optional, for China rail link-out | affiliate id | `TRIPCOM_AFFILIATE_ID` | unknown |
| GTFS (namtang, KTMB) | — | nothing — keyless | — | — | — |
| LTA DataMall | Ahmet | Optional (SG train only) | AccountKey | `LTA_DATAMALL_ACCOUNT_KEY` | email |

Keys go in `.env.local` (dev) and Vercel → Project → Settings → Environment Variables (prod).
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
