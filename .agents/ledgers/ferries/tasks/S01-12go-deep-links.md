# S01 — 12Go route deep links + affiliate tag
REPO: (this repo) · Depends: C01, F03 · Status: todo
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/12go.md`, then this.
**Model: sonnet** — URL building.

## Goal
Owner's ask:

> "my friend will handle flight ferry"

`links.ts` builds 12Go route-page URLs from slugs, tagged by exactly one affiliate path.
Used by S02 (ferries) and B04 (buses).

## Non-negotiables
- One tag path per link (ADR in PLAN D3): TP marker if `TRAVELPAYOUTS_MARKER` set, else direct `TWELVEGO_AFFILIATE_ID`, else untagged.
- Direct-program param (`?z=`) is `unverified` in doc — do not ship it until confirmed on agent.12go dashboard; patch doc.
- `/en/` prefix only.
- No server fetch of 12Go.

## Context (anchors)
- F03 `withTpMarker` in `providers/travelpayouts/links.ts` — reuse; don't duplicate TP click URL format.
- Doc § Endpoints TP click URL format.

## Steps
- [ ] `providers/12go/links.ts` `twelveGoUrl(fromSlug, toSlug)` + `tagged(url)`.
- [ ] Tests: TP marker → c44 click URL with encoded `custom_url`; neither env → plain URL; both env → TP only.
- [ ] Manual: open Bangkok→Koh Samui link in browser; confirm route page loads; note in doc `observed`.

## Definition of done
- Helper exported, tested, one manual link verified.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- 12go`

## Notes

- 2026-10-02: Implemented `src/lib/transport/providers/12go/links.ts` with exactly one
  affiliate path: Travelpayouts marker, direct `z` ID fallback, or plain URL.
- 2026-10-02: Added focused link and adapter coverage; `pnpm lint`, `pnpm exec tsc --noEmit`,
  and `pnpm test -- 12go` pass. Live browser verification remains an operational follow-up.
