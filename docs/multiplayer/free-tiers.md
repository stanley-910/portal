# Free-tier limits (POR-42)

Checked 2026-10-02 against official docs/pricing pages. "Verified: yes" means a primary vendor page states it.

## Verdict

Safe for a 5-20 user demo on all three services, with three things to design around:

1. **Liveblocks: 10 simultaneous connections per room (Free AND Pro; Team is 50).** Each browser tab is a connection. A single shared room with 11+ people rejects the extra joiners (error code 4005, no JS exception). Upgrading to Pro does not fix it. Shard users across several rooms (e.g. one room per trip or per globe region, cap 10 joiners) and handle `4005` in the UI.
2. **Liveblocks: 3,000 collaboration minutes per month, hard cap.** One minute = one connected user-minute while 2+ people are in the room (solo = free). 20 users x 30 min = 600. Team dev/testing with forgotten tabs can burn the rest. At the cap, activity pauses until the 1st of next month and users cannot join, so the demo would die. Check the dashboard usage page the day before; close idle tabs.
3. **Vercel Hobby is non-commercial only.** Fine for a hackathon. Stripe test mode is arguably not "requesting payment" but it is a grey area (see table); do not take real money or ads on it.

Smaller gotchas: Supabase anonymous sign-ins are limited to 30/hour per IP (a venue with shared NAT plus repeat testing can trip it; raise it in the dashboard). Supabase Free projects pause after 1 week of inactivity, so wake it before the demo. ~10 Hz cursor/camera presence is fine for Liveblocks (default client throttle is exactly 100 ms and no server-side msg/s cap is documented), but would exceed Supabase Realtime's 100 msg/s if used as the fallback.

## Liveblocks (Free)

| Limit | Value | Source URL | Verified |
|---|---|---|---|
| Simultaneous connections per room | 10 (Pro 10, Team 50, Ent 100); each tab = 1 | https://liveblocks.io/docs/pricing/limits | yes |
| Simultaneous connections per project | Unlimited | https://liveblocks.io/docs/pricing/plans/free | yes |
| Room full behavior | Extra joiner gets error code 4005; existing users unaffected | https://github.com/liveblocks/liveblocks/blob/main/guides/pages/what-happens-when-a-user-joins-a-room-at-maximum-capacity.mdx | yes |
| Realtime collaboration minutes | 3,000/month included, hard cap | https://liveblocks.io/docs/pricing/plans/free | yes |
| What a minute is | Connected user-minutes while 2+ people/agents share a room; "Solo sessions cost $0" | https://liveblocks.io/pricing (FAQ) | yes (background-tab handling not confirmed) |
| Monthly active users | Unlimited | https://liveblocks.io/docs/pricing/limits | yes |
| Monthly active rooms | Unlimited on limits page, but "500 included" on Free plan page (docs disagree) | https://liveblocks.io/docs/pricing/plans/free | yes (conflicting) |
| Anonymous connections | 3,000/month | https://liveblocks.io/docs/pricing/plans/free | yes |
| Realtime storage updates / data stored | 3M updates/month; 1 GB total; 10 MB per room | https://liveblocks.io/docs/pricing/plans/free | yes |
| Projects / dashboard seats | 10 / 3 (no more seats purchasable) | https://liveblocks.io/pricing | yes |
| Broadcast event size | 32 MB per message (clients >= 3.14; 1 MB older) | https://liveblocks.io/docs/pricing/limits | yes |
| Presence/broadcast messages per second (server cap) | Not documented | https://liveblocks.io/docs/pricing/limits | unverified (none stated) |
| Client send throttle | Default 100 ms (10 updates/s); configurable 16-1000 ms | https://liveblocks.io/docs/api-reference/liveblocks-client | yes |
| Commercial use | Allowed on Free if the Liveblocks watermark stays visible; removing it needs Pro ($30/mo, $25 annual) | https://liveblocks.io/pricing (FAQ) | yes |
| When exceeded | Hard caps: email + dashboard banner near limit, then the feature pauses until the 1st of next month (users cannot join rooms) | https://liveblocks.io/docs/pricing/limits | yes |

## Supabase (Free)

| Limit | Value | Source URL | Verified |
|---|---|---|---|
| Database size | 500 MB per project (shared CPU, 500 MB RAM) | https://supabase.com/pricing | yes |
| Auth MAU | 50,000 included | https://supabase.com/pricing | yes |
| Anonymous users count toward MAU? | Yes in practice: MAU = distinct users who sign in or refresh a token per cycle; anonymous users are rows in auth.users. A sign-out or cleared storage creates a new user (new MAU) | https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users ; https://github.com/orgs/supabase/discussions/35933 | inferred (docs never say "anonymous" explicitly; pricing page only lists anonymous sign-ins as "Included") |
| Anonymous sign-in rate limit | 30 requests/hour per IP (burst to 30; configurable in dashboard) | https://supabase.com/docs/guides/auth/auth-anonymous | yes |
| Anonymous abuse guidance | Docs strongly recommend CAPTCHA/Turnstile; no automatic cleanup of anon users (delete via SQL) | https://supabase.com/docs/guides/auth/auth-anonymous | yes |
| Realtime concurrent connections | 200 | https://supabase.com/docs/guides/realtime/limits | yes |
| Realtime messages per second | 100 (presence: 20/s; channel joins 100/s) | https://supabase.com/docs/guides/realtime/limits | yes |
| Realtime monthly messages / payload | 2M/month; 256 KB per message | https://supabase.com/pricing | yes |
| Egress | 5 GB + 5 GB cached | https://supabase.com/pricing | yes |
| Inactivity pausing | Paused after 1 week of inactivity; max 2 active free projects | https://supabase.com/pricing | yes |
| Exceeding quotas | Notice, grace period, then restrictions (pause, read-only DB, 402 responses) | https://supabase.com/docs/guides/platform/billing-faq | yes |

## Vercel (Hobby)

| Limit | Value | Source URL | Verified |
|---|---|---|---|
| Function max duration (Fluid compute, default for new projects) | 300 s default and max (Pro: up to 800 s) | https://vercel.com/docs/functions/limitations | yes |
| Function duration, legacy non-Fluid (projects before 2025-04-23) | 10 s default, 60 s max | https://vercel.com/docs/limits | yes |
| Streaming | Counts toward duration; 504 FUNCTION_INVOCATION_TIMEOUT if exceeded. Edge runtime must start responding within 25 s | https://vercel.com/docs/functions/limitations | yes |
| Function invocations | First 1,000,000/month | https://vercel.com/docs/plans/hobby | yes |
| Active CPU / provisioned memory | 4 CPU-hrs / 360 GB-hrs per month; I/O wait (AI model, DB calls) is not active CPU | https://vercel.com/docs/plans/hobby ; https://vercel.com/docs/functions/limitations | yes |
| Bandwidth | Fast Data Transfer first 100 GB; Fast Origin Transfer 10 GB; 1M CDN requests | https://vercel.com/docs/plans/hobby | yes |
| Request/response body | 4.5 MB per function | https://vercel.com/docs/functions/limitations | yes |
| Function regions | Single region on Hobby; default iad1 (Washington, D.C.) | https://vercel.com/docs/functions/configuring-functions/region | yes |
| Deployments per day | 100 | https://vercel.com/docs/plans/hobby | yes |
| Commercial use | Hobby is "non-commercial personal use only". Commercial = any deployment for financial gain of anyone involved, incl. "any method of requesting or processing payment from visitors". Donations are fine | https://vercel.com/docs/limits/fair-use-guidelines | yes (whether Stripe test mode counts is our inference, not stated) |
| When exceeded | Wait ~30 days before the feature works again | https://vercel.com/docs/plans/hobby | yes |
| Outbound requests to Chinese hosts | No Vercel restriction found. Latency/reliability risk only (no mainland China presence; GFW may throttle). hkg1 is available but OpenAI blocked Hong Kong origin traffic (2024), so keep AI routes out of hkg1. Hobby has one region, so a HK region would move the whole app | https://vercel.com/changelog/openai-will-not-support-the-hong-kong-region-hkg1-for-functions | inferred (no primary statement on outbound China traffic) |

## Fallbacks (only if a limit bites)

- Liveblocks room cap: shard rooms (free, preferred). Paying only helps at Team ($500/mo, 50 conns), so it is not a hackathon option.
- Liveblocks realtime alternative: Supabase Realtime Broadcast/Presence (200 conns, 100 msg/s on Free); throttle cursors to ~3 Hz at 20 users. Other vendors (PartyKit/Cloudflare, Ably, Pusher): unverified, not researched.
- Vercel Hobby commercial concern: move to Cloudflare Pages/Netlify free tiers or Vercel Pro trial: unverified, not researched.
