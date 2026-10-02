# Agent skills

Repo-local skills. Copilot CLI loads `.agents/skills/` natively; Claude Code users already have
`superpowers` as a plugin, so only the ledger skills are vendored here.

| Skill | Use when |
|---|---|
| `plan-initiative` | New thing to build, no ledger yet. |
| `update-initiative` | Ledger exists, something changed: new ask, re-scope, block, superseded ADR, stale REFERENCE. |
| `verification-before-completion` | About to call a task done. |

**Path override.** Skills say `.{slug}/` at repo root. Here ledgers live at
`.agents/ledgers/<slug>/`. Same files, different parent. Never create a root `.{slug}/`.

Vendored from Group-6 `.agents/skills/` (itself from
[sezaiemrekonuk/ledger-driven-development-skill](https://github.com/sezaiemrekonuk/ledger-driven-development-skill)
@ `5efc068` and superpowers v6.2.0, MIT). Re-sync:

```bash
git clone --depth 1 https://github.com/sezaiemrekonuk/ledger-driven-development-skill /tmp/ldd
cp -R /tmp/ldd/skills/plan-initiative /tmp/ldd/skills/update-initiative .agents/skills/
```
