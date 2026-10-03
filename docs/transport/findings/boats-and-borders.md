# Boats and border crossings: source decisions

Checked 2026-10-03, before implementation. Tickets B and C share this report. This work does **not** claim live ferry or coach inventory: none of the evaluated commercial sources supplied public, implementable search/booking documentation plus approved access. No accounts, contracts, payments or messages were created.

## Findings table

“Website” means an end-user booking flow, not permission or credentials to call its internal endpoints. “Unverified” is deliberately different from “no API exists”.

| Source | Corridors covered | Live fares? | Live seats? | Can book via API? | Access (key, contract, identity checks) | Terms on scraping | Reliability notes / decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [12Go agent programme](https://agent.12go.asia/) / [agreement](https://agent.12go.asia/agreement) | Thai islands, Bali, mainland SEA, other inventory subject to contract | Partner product; not accessible here | Partner product; not accessible here | Programme explicitly defines search and booking API | Established website + contact/application; affiliate ID alone is not an API credential | No automated extraction permission established | Best single commercial candidate for B/C; **defer adapter** until actual endpoint/schema, credentials and route inventory are supplied. Keep existing link-outs. |
| [TurboJET](https://www2.turbojet.com.hk/) / [Cotai Water Jet](https://www.cotaiwaterjet.com/) | HK–Macau Outer Harbour/Taipa | Website | Website | Public partner schema not found | Operator/reseller agreement unknown | No permission established; no request scraper | Prefer official schedules over reseller prose; keep existing estimated data pending operator-specific schedule refresh. |
| [HKIA SkyPier](https://www.hongkongairport.com/en/transport/mainland-connection/ferry-transfer.page) | HK airport–Macau | No | No | No | Public transfer information | Read-only research | SkyPier is **airside transfers only**, excludes passengers starting in HK; Taipa ferry explicitly marked temporarily unavailable. Remove the misleading SkyPier–Taipa seed. |
| [Batamfast](https://www.batamfast.com/home/index.ashx) | HarbourFront/Tanah Merah–Batam | Website; headline fares exclude tax/surcharge | Website | Public partner schema not found | [Partner enquiry](https://www.batamfast.com/) | [Terms](https://www.batamfast.com/legal/termsconditions.ashx) reviewed; robots retrieval failed, no permission inferred | Official directional timetable effective 2026-09-17, named interline operators and weekday footnotes. Implement a small cited timetable subset, **no scraped runtime search or live fare claim**. |
| [Bintan Resort Ferries](https://www.brf.com.sg/) | Tanah Merah–Bandar Bentan Telani | Website | Website | Public partner schema not found | Agent login, terms approval required | [Terms of use](https://www.brf.com.sg/terms-of-use/) reviewed; robots retrieval failed; no automated refresh permission established | Published directional weekday timetable and 70-minute duration; implement cited timetable subset, not seat availability. |
| [Camellia Line](https://www.camellia-line.co.jp/cgi-bin/calendar/index.pl) | Busan–Hakata (Fukuoka) | Website | Website | Public partner schema not found | Operator booking flow | robots retrieval failed; no scraper | Directional overnight service; departures differ from boarding/immigration times. Calendar warns of cancellations. Use operator timetable only if current source can be verified; never revive Queen Beetle by assumption. |
| [PanStar](https://www.panstarcruise.com/product/osaka/info) | Busan–Osaka | Website | Website | Public partner schema not found | Operator booking flow | No permission established | Current operator publishes schedule-change notices (including Sunday departures). Defer until dated calendar can be validated; do not invent daily sailings. |
| [Incheon Port Authority](https://www.icpa.or.kr/icferry/mobile/content/view.do?contentKey=10&menuKey=976), Weidong | China–Korea (Qingdao/Weihai–Incheon) | Operator website | Operator website | Public schema unverified | Operator/agent enquiry | No permission established | Passenger and cargo calendars differ. Defer; cargo RORO schedules are not proof of passenger departures. |
| [Raja Ferry](https://www.rajaferryport.com/media/M0056.pdf), [Lomprayah](https://www.lomprayah.com/), [Andaman Wave Master](https://www.andamanwavemaster.com/), [Bundhaya](https://www.bundhayaspeedboat.com/) | Donsak–Samui/Phangan, Phuket–Phi Phi, Lanta–Lipe | Website | Website | No verified public partner schema | Operator/12Go approval | No request scraping permission established | PDFs/seasonal schedules are useful future snapshot inputs. Preserve seed freshness; Lanta–Lipe seasonality needs dated verification, not a year-round promise. |
| [Maruti](https://www.marutifastboats.com/book-ticket/), [Eka Jaya](https://ekajayafastboat.com/schedules.html) | Sanur–Penida, Padang Bai–Gili | Website | Website | Public schema not found | Operator/12Go approval | No permission established | Several similarly named domains; keep official provenance and existing estimated seed, do not infer an API from a booking form. |
| [Trans-Island Chinalink](https://www.tilchinalink.com/) | HK–Shenzhen/Guangzhou coach | Website | Website | Public schema not found | Operator/agent agreement unknown | No permission established | Route/stop-specific service; no defensible universal HK–Guangzhou departure time. Defer new coach rows pending source schedule. |
| [BusOnlineTicket](https://www.busonlineticket.com/affiliate-program/) | Singapore–JB–KL, Malaysia–Thailand | Website / partner | Website / partner | XML API advertised | Affiliate approval; separate API terms/documentation needed | No scraper; published integration uses approved widgets | **BOT_REFERER_ID is link attribution, not an API key.** Retain seed and add its missing source attribution. |
| [Easybook](https://www.easybook.com/en-id/affiliate), [sandbox](https://api-test.easybook.com/sandbox/index) | Malaysia/Singapore/Thailand and ferries, exact contract coverage unverified | Website | Website | Sandbox exists; usable schema not retrieved | Approved agent ID; partner API approval unknown | No permission established | Affiliate widget docs are not server API docs. Unrelated easybook.net hotel software is not this bus supplier. Defer. |
| [Bookaway](https://www.bookaway.com/affiliates) | Global ground/sea, including SEA | Website | Website | Affiliate page documents links, not a public booking schema | Application approval | No permission established | Reject as immediate API implementation; route coverage and API access need partner confirmation. |
| [Trip.com developers](https://developers.trip.com/?lang=en-US) / [affiliate tools](https://www.trip.com/partners/help/faq/tools) | Rail incl. China; exact China–Laos inventory unverified | Website / partner | Website / partner | Train product advertised; gated details | Partner agreement/key | No scraping authority established | Affiliate IDs/URLs do not grant API access. China–Laos shared with train workstream; no invented timetable. |
| [Ferryhopper Partner Hub](https://partners.ferryhopper.com/) | Ferries; SEA marketed but route inventory must be checked | Partner product | Partner product | Booking API advertised | Partner onboarding | Affiliate terms require accurate authorised claims; no scraping permission | Candidate after contract; no implementation without documented schema. |
| [Direct Ferries](https://www.directferries.com/affiliate.htm) / [Connect](https://www.directferriesconnect.com/news/direct-ferries-launches-b2b-brand-amp-new-booking-api-direct-ferries-connect) | International ferries, exact Asian inventory contract-dependent | Partner product | Partner product | Yes, advertised B2B booking API | Approved partnership | No scraping permission established | Best alternate ferry aggregator; defer until approved schema/key. |
| [Giant Ibis](https://www.giantibis.com/schedule), [Laos tourism bus schedules](https://welcometolaos.com/) | Bangkok/Cambodia/Vietnam; Thai–Laos bridges | Website / published schedule | Website only | No public schema verified | Operator/12Go | No request scraper | Keep existing sources as estimates; border disruption and date-specific service not represented by evergreen schedules. |
| [Malaysia official GTFS](https://developer.data.gov.my/realtime-api/gtfs-static), Thai OTP, HK government | KTMB / MY–TH rail / border information | No | No | No | Open-data feed | Feed terms, no website scraper needed | Best reliability available for scheduled rail; owned by Ticket A. Border opening hours cannot create coach times or seats. |

## Corridor decisions and caveats

| Ticket / priority | Selection now | Limit / next access needed |
| --- | --- | --- |
| B1 HK–Macau | Existing official-source seed; suppress suspended/ineligible SkyPier–Taipa | Operator or 12Go approved API; city ferry and airside transfer must remain distinct |
| B2 SG–Batam | Official Batamfast directional timetable subset, no fare | Batam is UTC+7, Singapore UTC+8; named Sindo interline sailings must not be labelled Batamfast-operated |
| B3 Thai islands | Existing timetable fallback, 12Go preferred live candidate | Seasonal schedules and date availability need operator/12Go documentation |
| B4 Bali | Existing timetable fallback, 12Go preferred live candidate | Confirm actual operating company and route inventory before enabling live |
| B5 Busan–Fukuoka | Official Camellia timetable if verified, no fare | Board/check-in before sailing; Busan arrival at Hakata is next morning; cancellations not encoded |
| C1 HK–Shenzhen/Guangzhou | Rail workstream; coach deferred | [HK Immigration](https://www.immd.gov.hk/eng/contactus/control_points.html) distinguishes control points; Shenzhen Bay normally 06:30–midnight, Lok Ma Chau 24 h. Do not attach one crossing's hours to every coach. |
| C2 SG–JB–KL | Existing BOT + refreshed KTMB | [ICA](https://ask.gov.sg/ica/questions/clos83fvv01l15k0whuldjjuw?from=topics): arriving bus passengers bring belongings/luggage off for screening. No guaranteed border dwell time. |
| C3 Thailand/Laos/Cambodia/Vietnam | Existing sourced seed; 12Go access deferred | No blanket visa-on-arrival promise: nationality and exact crossing matter. Thai–Cambodia operations need date-specific confirmation. |
| C4 Kunming–Vientiane | Coordinate with rail workstream; no fabricated services | China–Laos train API/timetable remains gated or unverified; passport/visa clearance at both borders must be checked |
| C5 Korea–Japan / China–Korea | Camellia subset; Osaka/China deferred | Do not confuse immigration close, sailing and disembarkation times; passenger calendar required |
| C6 SG–Batam/Bintan | Operator timetable subsets | Bintan UTC+7; [BRF FAQ](https://www.brf.com.sg/) requires immigration clearance, passport/visa checks; operator advises checking visa eligibility. No individual visa determination in app. |
| C7 Malaysia–Thailand | Existing BOT + rail workstream | [KTMB timetable](https://www.ktmb.com.my/assets/pdf/2023/ETS-KOM-SRT-Timetable.pdf) explicitly distinguishes Malaysia/Thailand times; separate SRT/KTMB legs must not imply through-ticket or protected transfer |

## Implementation boundary

A new `official-ferries` provider will expose a small **timetable** subset with explicit direction, weekday restrictions, source and checked date. It is an offline snapshot, not an API integration; no added credential is needed. Existing 12Go/BOT seeds keep working without affiliate IDs. Suspended SkyPier rows are a deliberate correction to previously misleading behaviour. Runtime scraping is excluded because permission and a stable contract are unverified. A future live adapter needs its own server key, 8-second abortable request, recorded response fixtures and honest fallback. No undocumented endpoint is guessed.

Refresh remains a manual source review for this snapshot. An automated scraper is **not** shipped merely because robots.txt could not be retrieved. Live-data acceptance remains blocked on partner access; the report is intended for the PR description together with actual validation results.

## Shipped coverage and upkeep

Implemented B2/C6 in both directions as an intentionally small Batamfast/BRF subset, and B5/C5 Busan–Hakata in both directions. B1's suspended SkyPier row is removed. C2 retains BOT rows with visible source/check date and Singapore arrival screening note. Remaining B3/B4/C1/C3/C4/C5 Osaka/China/C7 live-source gaps are **not implemented**, for the access or dated-calendar blockers above. No provider can claim live ferry or coach data from this patch.

The current Camellia brochure is linked by `/dia/` to
[`en_pamphlet.pdf`](https://www.camellia-line.co.jp/wp-content/themes/2017theme_0111/camellialine/pdf/en_pamphlet.pdf).
The older indexed 2025 PDF and CGI calendar return 404; they were rejected as implementation sources. The current
brochure was downloaded and visually checked using the PDF skill: Hakata 12:30 → Busan 18:30; Busan 22:30 → Hakata
07:30 next morning (disembarkation). Check-in closes before sailing. No brochure fares were imported.
Batam crossing durations are independently cited to Direct Ferries' directional route pages: 70 minutes for
HarbourFront–Batam Centre, 60 minutes for Tanah Merah–Batam Centre. The reseller's displayed arrival clock is not
copied because it does not expose the port offset clearly; arrival is calculated from duration in the destination timezone.

`src/lib/transport/providers/official-ferries/fixtures/` contains the recorded Batamfast HTML table, a BRF timetable
transcription and Camellia schedule notes, with SHA-256 hashes and a PDF upstream digest. These are research evidence,
not mocks passed off as live API fixtures. BRF's direct HTTP request returned 403, although the indexed official page
was readable; no bypass or periodic scraper is installed. Robots retrieval through the research tool failed for all
three operators, so no automated extraction permission is inferred. Terms: Batamfast general carriage conditions and
BRF Terms of Use were reviewed; neither establishes this app's right to poll and republish live booking inventory.
The selected implementation is the **lowest-tier manual official-timetable snapshot**, preferred to an undocumented
API but below an authorised API/feed/build-time scraper in the briefing's reliability ranking.

Run the offline upkeep check at least monthly:

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-ferry-sources.mts --check
# Inspect a freshly saved operator page/PDF without fetching or mutating from the script:
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-ferry-sources.mts --compare batamfast /path/to/page.html
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-ferry-sources.mts --compare brf /path/to/timetable-transcription.txt
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-ferry-sources.mts --compare camellia /path/to/brochure.pdf
```

A source-content change or more than 30 days since review fails the check and preserves the last good seed. An unchanged
HTML table/PDF is **not** proof of today's sailing or seats. The reviewer must inspect notices, direction, operator,
weekday footnotes, timezone, duration evidence and border/check-in instructions; then update the seed, evidence and
manifest review dates/hashes together, rerun targeted tests, and include the reviewed diff. BRF text comparison expects
the same explicitly documented transcription format; it is not an HTML scraper. There is no scheduled refresh job or
credential smoke call, because there is no authorised live adapter.
