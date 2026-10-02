# Ferries — REFERENCE

Codebase: core `REFERENCE.md`. Provider truth: `.agents/docs/api/12go.md`.

| Thing | Value |
|---|---|
| Provider id | `12go` |
| Folder | `src/lib/transport/providers/12go/` (shared with buses, ADR-S02) |
| Env | `TWELVEGO_AFFILIATE_ID` (direct program, public-safe), shared `TRAVELPAYOUTS_MARKER`/`TRS`/`TOKEN` |
| API | none public. Do not call 12Go servers from code (bot challenge + ToS). |
| Route URL | `https://12go.asia/en/travel/{from-slug}/{to-slug}`; slugs lowercase-hyphen, unpublished → hand-verify each |
| TP link | `https://c44.travelpayouts.com/click?shmarker={marker}&promo_id=1764&source_type=customlink&type=click&custom_url={encoded}` |
| Robots | use `/en/`; `he,hi,km,lo,my` prefixes disallowed |

Seed row shape (S02 freezes, ADR-S02):

```ts
interface SeedRoute {
  from: { name: string; lat: number; lng: number; country: string; slug: string };
  to:   { name: string; lat: number; lng: number; country: string; slug: string };
  operators: string[];      // e.g. ["Lomprayah", "Raja Ferry"]
  departures: string[];     // "HH:MM" local, typical daily (ADR-C05)
  tz: string;               // IANA, e.g. "Asia/Bangkok"
  durationMin: number;      // typical, from operator/public source
  source: string;           // URL we took it from — never 12go.asia
}
```
