---
task: B03
author: Ahmet
sessions: [2026-10-02]
model: claude-opus-5-5
model_recommended: claude-opus-5-5
iterations: 1
tools: [superpowers:test-driven-development]
---

## Session 1 — 2026-10-02

### What I asked for / what came back
"implement buses". Only B03 (opus) and B05 (sonnet) eligible; B01/B02/B04 wait on T01/T03/S02.
Did B03: build script, parser, city map, per-pair JSON, `gtfs` adapter, 12 tests, live build.

### Methodology trace
`gtfs.md` § Gotchas + § Recommended approach → downloaded namtang, profiled frequencies in
python → hand-made fixture (headway 0, chained windows, 25:10, rail + urban decoys, calendar
exception) → `gtfs.test.ts` red on missing modules → `build.ts`/`schedule.ts`/`index.ts` → green →
`pnpm gtfs:build` → curl BKK→CNX 27 offers.

### Friction
- Doc said quirk = `headway_secs=0`; reality: 95 % of rows chain windows with headway = window
  length. Spec end-exclusive drops last departure → ADR-B04, doc patched.
- `build.ts` must run under plain node (type stripping) and vitest → `.ts` specifiers +
  `allowImportingTsExtensions`; node warns typeless package → `--disable-warning`.
- Registry stub tests assumed every provider is a stub → `LANDED` set.
- Main checkout had stale uncommitted C01 edits (`package.json`, lockfile, core STATE) → left untouched, worked in worktree.

### What I rejected and rewrote by hand
- Runtime `fs.readFile` of pair files (needs `outputFileTracingIncludes`) → generated lazy
  `import()` loader map, bundler-safe.
