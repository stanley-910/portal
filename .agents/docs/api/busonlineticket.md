# BusOnlineTicket.com — API ground truth
Checked: 2026-10-02 · Modes: buses (also train/ferry on same site) · Seat: Ahmet

**NOT a free public API.** No public REST/JSON API, no public docs, no self-serve key. Only: approval-gated affiliate program (JS search widget + text/banner links; "XML API*" mentioned with asterisk, zero public docs) or prepaid agent account (email sales). For hackathon: treat as **deep-link-out only**.

## Verdict
- Public API: **none found**. `/api` → 404 (observed). No developer portal, no OpenAPI, no docs.
- Affiliate program: free to join, **manual approval**, form requires a live `Website`. Gives login ID = `refererid` for tracking + embeddable search widget. 50% revenue share (vendor claim).
- "XML API*": listed as integration option on affiliate page, asterisk unexplained, no spec published → `unverified`, assume partner-only negotiation via sales.
- Prepaid agent (B2B): "please email sales@busonlineticket.com". Prepaid top-up credit model. Not hackathon-viable.
- Usable in hackathon timeline: **deep links yes** (no auth, work today). Live fares/seat availability: **no** (would need scraping — don't).
- Fallback: schedules from GTFS (KTMB rail, Thai OTP intercity buses — see `gtfs.md`) + "Book on BusOnlineTicket" outbound link per city pair.

## Access
| Path | URL | What you get | Approval |
|---|---|---|---|
| Affiliate | https://www.busonlineticket.com/affiliate-program/#affiliate-registration | login ID (used as `BOTReferer_Id` / `refererid`), password, widget, links | manual, time `unverified`; "Once your application ... has been approved, you will receive an email" |
| Affiliate (TH site) | https://www.busonlineticket.co.th/affiliate-program/ | same program, TH domain | same |
| Affiliate via network | Involve Asia (app.involve.asia) | network-tracked links, "up to 3%" (blog, 2022-11-22) | 2-4 business days account + up to 2 days program (third-party blog, `unverified`) |
| Prepaid agent | https://www.busonlineticket.com/agent-registration/ | agent booking login, prepaid credit | email sales@busonlineticket.com |

Registration form fields (observed, ASP.NET names): `txtUsername`, `txtPassword`, `txtCPassword`, `txtWebsite`, `txtName`, `txtEmail`, `txtPhone`, `txtCompany`, `txtAddress`, `chkTnC`.

Affiliate T&C highlights (affiliate page): monthly payout end of next month if min payout met (min amount not stated); unpaid <min forfeited after 2 years; **no bidding on "BusOnlineTicket" brand keywords**; terms may change without notice.

Env vars (we will use):
| Var | Value | Required |
|---|---|---|
| `BOT_REFERER_ID` | affiliate login ID; empty → plain links, no commission | optional |
| `BOT_BASE_URL` | `https://www.busonlineticket.com` (TH: `https://www.busonlineticket.co.th`) | optional, default |

## Auth + base URL
- No API auth exists publicly. Deep links: no auth.
- Base: `https://www.busonlineticket.com` (MY/SG). `https://www.busonlineticket.co.th` (TH). Observed both serve `/booking/<slug>` route pages.
- Tracking = query param `refererid=<BOT_REFERER_ID>` (observed in official widget JS `combine.js`).

## Endpoints we use
No API. "Endpoints" = public URLs the official affiliate widget builds (observed by reading `https://cdn.busonlineticket.com/js/affiliates/combine.js`).

| Method + path | Purpose | Key params | Response |
|---|---|---|---|
| GET `/booking/{from}-to-{to}-bus-tickets` | route landing page (SEO page w/ search box, "from SGD xx") | `from`,`to` = lowercased city, spaces→`-`; `?refererid=` | HTML 200; unknown pair → 404 (observed) |
| GET `/booking/{from}-to-{to}-ktm-ets` | train route page | same | HTML 200 (observed `kuala-lumpur-to-butterworth-ktm-ets`) |
| GET `/booking/{from}-to-{to}-ferry-tickets` | ferry route page | same | HTML (pattern from widget JS; not probed) |
| POST `/booking/{from}-to-{to}-{suffix}?refererid=` | what widget submits (form, `target=_blank`) | form fields `ddOrgFrom`,`ddOrgTo`,`deptdate` (`yy-mm-dd` datepicker = `YYYY-MM-DD`),`rtndate`,`pax`,`way` (`1` one-way / `2` return),`type` (`bus`/`train`/`ferry`), optional `tracking_id` | HTML results page |
| GET `/booking/select_coach.aspx?ddFrom=&ddTo=&deptdate=&rtndate=&pax=&way=&refererid=` | legacy URL built in widget JS but then overwritten | — | observed: **redirects to homepage** → don't use |
| GET `https://cdn.busonlineticket.com/js/all_route.js` | widget's station/city dropdown data (`var drpBus`, `drpTrain`, `drpFerry`) | — | ~1 MB JS literal, 565 distinct `mFrom` names (observed). Not an API; ToS for reuse `unverified` |

Example (observed, no auth):
```bash
curl -sSL -o /dev/null -w "%{http_code}\n" \
  "https://www.busonlineticket.com/booking/kuala-lumpur-to-singapore-bus-tickets?refererid=$BOT_REFERER_ID"
# 200  <title>50% Offer Kuala Lumpur to Singapore bus ticket from SGD 16.00 | BusOnlineTicket.com
```

Deep-link builder (our code, mirrors widget slug rule):
```ts
const slug = (s: string) => s.trim().replace(/ /g, "-").toLowerCase();
const botUrl = (from: string, to: string, mode: "bus"|"train"|"ferry" = "bus") =>
  `${process.env.BOT_BASE_URL ?? "https://www.busonlineticket.com"}/booking/${slug(from)}-to-${slug(to)}-${
    {bus:"bus-tickets",train:"ktm-ets",ferry:"ferry-tickets"}[mode]}` +
  (process.env.BOT_REFERER_ID ? `?refererid=${encodeURIComponent(process.env.BOT_REFERER_ID)}` : "");
```
Date/pax prefill only works via POST form (widget style) — a plain GET link lands on route page, user picks date there. GET with `deptdate` query on route page: `unverified` (no date param seen in route page HTML).

Official widget embed (gists linked from affiliate page, observed):
```html
<link rel="stylesheet" href="https://cdn.busonlineticket.com/css/affiliates/all.css">
<script src="https://cdn.busonlineticket.com/js/affiliates/combine.js"></script>
<script src="https://cdn.busonlineticket.com/js/all_route.js"></script>
<script>var BOTSize_Filter="265_424";var BOTDefault_Type="bus";var BOTDefault_From="";var BOTDefault_To="";var BOTReferer_Id="ID";</script>
<div id="divSearch_Box"><script>botsearch_box();</script></div>
```
Sizes: `265_424`, `315_291`, `570_294`. jQuery-based, injects own CSS → clashes with Paper Atlas tokens; avoid in our UI, build own link button.

## Limits
- Deep links: none documented. Don't hammer route pages (robots.txt allows `/booking/`, disallows only spam `/search/...` patterns + `/feed/rss2/`; observed).
- Affiliate: none documented. Widget date picker `maxDate:180` days ahead (widget JS, observed); train min date +1 day.
- XML API: `unverified` (no docs).

## Coverage
- Vendor claim (affiliate page): express bus Singapore + Malaysia; site nav: bus, bus+hotel, ferry, train (KTM ETS). TH site (`.co.th`) Thailand; footer links Indonesia. Cambodia/Vietnam per third-party summaries only → `unverified`.
- Currency selector: RM, S$, Rp (observed homepage).
- Route pages exist for many city pairs; existence check = 200 vs 404 on slug (observed).

## Errors
| Case | Observed |
|---|---|
| Unknown city-pair slug | HTTP 404, `<title>Page Not Found | BusOnlineTicket.com` |
| `select_coach.aspx` GET | redirected → homepage 200 (silent fail) |
| `/api` | 404 |

## Gotchas
- City names must match BOT naming (e.g. `Bandar Tasik Selatan (TBS)`, `JB Larkin Sentral`); slug of parentheses/odd names untested → link city-level (`kuala-lumpur`, `singapore`, `penang`) not terminal-level.
- Train suffix is `-ktm-ets` (KTM only), not `-train-tickets`.
- `refererid` only credits commission if ID is an approved affiliate; random value still 200 (observed `refererid=test`).
- Affiliate needs a public website URL at signup — Vercel preview URL may or may not pass review (`unverified`).
- No public T&C page for site at `/terms-and-conditions/` or `/terms-of-use/` (404 observed); scraping fares = no permission → don't.
- "XML API*" asterisk never explained; do not promise live availability in demo.

## Sources
| URL | What it confirms | Verified |
|---|---|---|
| https://www.busonlineticket.com/affiliate-program/ | 50% rev share, text/banner + "XML API*", widget vars, approval by email, T&C, reg form fields | yes (fetched) |
| https://gist.github.com/amalinazakaria/bf354e0854c17a4b52ad90c5b7808022 | widget head snippet (CSS/JS URLs, BOT* vars) | yes (fetched raw) |
| https://gist.github.com/amalinazakaria/bfb9ee8f3e950958370c7611bd829ada | widget body snippet `botsearch_box()` | yes (fetched raw) |
| https://cdn.busonlineticket.com/js/affiliates/combine.js | deep-link slug rule, `refererid`, POST form fields, suffixes, maxDate 180 | yes (observed) |
| https://cdn.busonlineticket.com/js/all_route.js | station lists `drpBus/drpTrain/drpFerry` | yes (observed) |
| https://www.busonlineticket.com/agent-registration/ | prepaid agent, email sales@busonlineticket.com, top-up model | yes (fetched) |
| https://www.busonlineticket.co.th/affiliate-program/ | TH affiliate same terms, no API docs | yes (fetched) |
| https://www.busonlineticket.com/booking/kuala-lumpur-to-singapore-bus-tickets | route page 200, title/price | yes (observed) |
| https://www.busonlineticket.com/robots.txt | crawl rules | yes (observed) |
| https://involve.asia/blog/bus-online-ticket-affiliate-program/ | network option, "up to 3%", approval days | unverified (third-party) |
| XML API spec | — | unverified (not published) |
