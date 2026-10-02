# EXECUTE — the execution prompt

For Ahmet and Cata. **This file is the prompt.** Paste or reference it:

```
Please execute @.agents/EXECUTE.md, do relevant tasks. I am Ahmet. If you face any
problems, /superpowers:brainstorm to fix and update the task/ledgers.
```

Part 1 = what the agent obeys. Part 2 = what the humans need.
First-time machine setup: `.agents/SETUP.md`. API ground truth: `.agents/docs/api/`.

---

# Part 1 — the prompt

## 1. Who you are

Invocation names you: Ahmet or Cata. **If it does not, stop and ask.** Never guess — guessing
writes into the other person's ledger.

| Person | Ledgers |
|---|---|
| Ahmet | core `C01`, trains (`T*`), buses (`B*`) |
| Cata | core `C02`, flights (`F*`), ferries (`S*`) |

Prefixes unique per ledger — `C` core, `F` flights, `S` sea/ferries, `T` trains, `B` buses —
so an ID alone tells you whose it is. Core is the only per-task split; every other ledger
belongs wholly to one person.

**12Go is shared.** One provider, two seats: ferries (`S`, Cata) and buses (`B`, Ahmet). The
12Go HTTP client lives in one file owned by whichever task lands first (see
`ledgers/ferries/STATE.md` and `ledgers/buses/STATE.md` → cross-ledger tables). The second
seat imports it; never fork a second client.

**This table is the only authority on ownership.** No `Owner` column in any `STATE.md`.

## 2. Preflight

```bash
git pull --rebase origin main
git status --porcelain
```

`git status --porcelain` must be empty. Dirty tree = previous run died before § 10: **stop and
report.** Never commit someone else's leftover work.

## 3. The dependency graph

```bash
awk -F'|' 'NF>=6 {
  id=$2; s=$5; d=$6
  gsub(/^[ \t]+|[ \t]+$/,"",id); gsub(/^[ \t]+|[ \t]+$/,"",s); gsub(/^[ \t]+|[ \t]+$/,"",d)
  if (id ~ /^[A-Z][0-9]+$/ && s ~ /^(todo|in_progress|done|blocked|retired)$/) printf "%-4s %-12s <- %s\n", id, s, d
}' .agents/ledgers/*/STATE.md
```

Every task, status, direct deps. `Depends on` is machine truth, cross-ledger IDs included. The
status filter keeps narrative tables out.

## 4. Pick your task

In order:

1. **Row of yours `in_progress`?** Resume it.
2. **Else: first row that is yours, `todo`, every `Depends on` ID `done`.** Order `C` → `F` →
   `S` → `T` → `B`, then ascending number.
3. **Nothing eligible?** Walk your blocked row's deps until a not-`done` task that is not yours,
   or one `blocked`. That is the root blocker. Print exactly:

   ```
   BLOCKED <your ID> needs <blocker ID> (<status>, owner <name>)
   ```

   and **end the run.** Do not start the blocker — other seat.
4. **All yours `done`/`retired`?** Say so, end.
5. **`Depends on` names unknown ID, or loop?** Ledger contradicts itself. Print it, end.
   `/superpowers:brainstorm` job.

## 5. Check the tier

Read the task's row in its ledger's `MODELS.md`. `opus` → opus-tier, `sonnet` → sonnet-tier.
Haiku/mini/flash: banned. Tier ≠ running model → print `TIER <ID> needs <tier>, running <model>`
and end.

## 6. The loop

1. Flip row to `in_progress` in that ledger's `STATE.md`.
2. Read that ledger's `REFERENCE.md` — once per run. Patch only if your task made it stale.
3. Read the provider doc(s) the task names under `.agents/docs/api/`. **That doc is ground
   truth.** Reality disagrees (field renamed, endpoint 404, limit differs)? Fix the doc in the
   same run, mark the line `observed 2026-MM-DD`, cite the response. Never code against memory.
4. Read **only** that task's file under `tasks/`.
5. Do the work, ticking `## Steps`.
6. Run `## Verification` **exactly as written.** Fails → fix code, never command. Passes before
   any code written → test is wrong.
7. Fill `## Notes` — hand-off only.
8. Flip row to `done`, repoint "Current task", rewrite "Last session ended".
9. Write `.agents/devlogs/<task basename>.md` (Part 2 § Devlog).
10. Commit, push, open PR (§ 10).
11. **Stop. One task per session.** Report, end.

No subagents running tasks concurrently — two seats is the
parallelism; inside a run one working tree.

### Test-first, non-negotiable

Every adapter: record a real (or doc-copied) response into `src/lib/transport/providers/<id>/
__fixtures__/`, write the mapper test against it, see it **red**, then implement. No network in
unit tests. Live calls only in `## Verification` smoke steps.

## 7. Gates

```bash
pnpm lint && pnpm exec tsc --noEmit
pnpm test            # exists after C01; before that say "no test script yet" in report
```

Skipping a gate silently = how main goes red. Say what ran.

## 7b. Write short

- Comments: default none. Only non-obvious *why*, spec clause, trap.
- Docs caveman-terse. Bullets > prose, tables > bullets.
- Keep search keys: IDs, files, symbols, env var names, error codes exact.
- Budgets: `## Notes` ≤ 40 lines. Devlog session ≤ 40. ADR ≤ 15. "Last session ended" ≤ 8.
- One home per fact. Reference by ID.

## 8. Never

- Push to `main` or force-push. Task branches only.
- Merge your own PR.
- Work a task § 1 does not give you.
- Edit `src/lib/transport/types.ts` outside `C01` (Part 2 § Contract protocol).
- Renumber/reuse a task ID. Scope changed? Append new ID (`update-initiative`).
- Edit a past ADR. Append-only.
- Put a secret in code, fixture, log, devlog, doc example. Env var names only.
- Call a provider from the browser. Server route handlers only — keys never ship to client.
- Guess credentials, quotas, ToS, or a team decision.
- Hard-code colours/fonts/radii in UI — `DESIGN.md` + `src/design/tokens.json`.

## 9. Blocked mid-task

1. Flip row to `blocked`.
2. `STATE.md` → `## Open blockers`: what is needed, who provides it, IDs it unblocks.
3. End run, tell the other seat. No switching tasks.

Typical blocker here: **API key not yet approved.** Block, don't stub-and-call-it-done.

## 10. Ship it

Run these yourself, Conventional Commits — never hand them to the human:

```bash
git switch -c <id>-<slug>
git add -A && git commit -m "$(cat <<'EOF'
<type>(<scope>): <short description>

Task: <ID>
EOF
)"
git push -u origin <id>-<slug>
gh pr create --title "<type>(<scope>): <short description>" --body "Task: <ID>"
```

Report: task done + PR URL. Other seat reviews and merges; never self-merge. Push rejected or
`gh` not authed → report exact error, leave branch committed locally.

### 10b. Ahmet's flow — overrides the block above for Ahmet

| Step | Rule |
|---|---|
| Integration branch | `dev/ahmet` (tracks `origin/dev/ahmet`). Behind `main` → `git merge --ff-only main` first |
| Task branch | `<id>-<slug>`, **local only, never pushed**, in its own worktree: `git worktree add ../portal-<id> -b <id>-<slug> dev/ahmet` |
| Parallel tasks | one worktree per task branch, all cut from `dev/ahmet` |
| Commit | in the worktree, message as above |
| Merge | task branch → `dev/ahmet` (`git switch dev/ahmet && git merge --no-ff <id>-<slug>`) |
| PR | only `dev/ahmet` is pushed; PR `dev/ahmet` → `main` |
| Worktree setup | `pnpm install` per worktree; needs Node ≥ 22.13 (pnpm 11) — shell default may be older, check `node -v` |

---

# Part 2 — team reference

## The five rules

- **Ledger is memory.** Not chat.
- **§ 4 decides next.** Not "Current task", not you.
- **IDs permanent.** Never renumbered, never reused.
- **Decisions append-only.**
- **Verification is a command.**

## Ground-truth docs

`.agents/docs/api/<provider>.md`, one per provider, fixed shape (Verdict, Access, Auth,
Endpoints, Limits, Coverage, Errors, Gotchas, Sources). Index: `.agents/docs/api/README.md`.

- Every claim has a source URL or `observed <date>`. `unverified` lines are not ground truth —
  first task that hits them confirms or corrects.
- Doc beats memory. Code beats doc only after doc is patched to match.
- Provider changes (key approved, endpoint moved) → patch doc + ADR in owning ledger.

## Contract protocol — read before touching `src/lib/transport/types.ts`

Both seats code against one contract: `TransportProvider`, `SearchQuery`, `Offer`, `Segment`,
`Place`, `ProviderError`. `C01` lands it with **stubs for every provider pre-registered** in
`src/lib/transport/registry.ts`, so neither seat edits the registry or the types later.

- Each adapter only replaces its own stub file `src/lib/transport/providers/<id>/index.ts`.
- Need a contract change? Not in a feature PR. ADR in `ledgers/core/DECISIONS.md`, new `C` task,
  both seats agree, merged alone.
- Additive optional fields only, ever, after `C01`.

## Devlog

**One file per task:** `.agents/devlogs/<task basename>.md`. No-ID sessions:
`.agents/devlogs/meta-<date>-<slug>.md`. Task spanning sessions appends `## Session N`.

```markdown
---
task: T01
author: Ahmet
sessions: [2026-10-03]
model: claude-opus-5-5
model_recommended: claude-opus-5-5
iterations: 2
tools: [superpowers:test-driven-development, cavecrew-investigator]
---

## Session 1 — 2026-10-03

### What I asked for / what came back
### Methodology trace
doc `taiwan-tdx.md` § Endpoints → fixture → red → green
### Friction
### What I rejected and rewrote by hand
```

≤ 40 lines per session block. `iterations` honest. Devlog ≠ `## Notes`: Notes for next agent,
devlog for humans/judges.

## Rules for every task

- English for everything authored.
- Route handlers never return display strings — stable `ProviderErrorCode`s; UI maps them.
- Every provider call: timeout (`AbortSignal.timeout`), one place for retries, cached per
  provider ToS. A slow provider must not stall the fan-out.
- Respect each provider's rate limit in code, not hope. Limits live in the provider doc.
- Attribution/ToS requirements from the doc are shipped, not backlogged.
- TypeScript strict. `any` needs a written reason.
- Stay in scope. Adjacent work → ledger Backlog.

## What blocks what

```
C01 types · registry with stubs · vitest · env schema  →  C02, every F/S/T/B task
C02 /api/transport/search fan-out · timeouts · merge    →  UI wiring (not in these ledgers)
```

`C01` first, alone. Adapter tasks parallel across seats after.
