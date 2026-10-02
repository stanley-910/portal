# B02 — Korea express + intercity bus
REPO: (this repo) · Depends: T03 · Status: todo
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/korea-data-go-kr.md`, then this.
**Model: sonnet** — mapper on T03 client.

## Goal
Owner's ask:

> "data.go.kr … Free for Buses"

Express (고속) for any date; intercity (시외) today-only.

## Non-negotiables
- `ExpBusInfo` and `SuburbsBusInfo` are separate data.go.kr applications — key must be approved for both (`unverified` whether one key covers all once approved).
- 시외 only when `q.date` = today Asia/Seoul; else skip silently (not an error).
- Terminal snapshots committed with hand-added coords + `source`.

## Steps
- [ ] Snapshot terminals (`GetExpBusTrminlList`, `GetSuberbsBusTrminlList`).
- [ ] `bus.ts` map → `Offer` (`carrier = gradeNm`, price `charge` KRW, times `YYYYMMDDHHMI`).
- [ ] Tests: time parse (12-digit), today-only rule, empty items.

## Definition of done
- Seoul (Express Bus Terminal) → Busan tomorrow returns express bus offers.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- korea-tago`

## Notes

