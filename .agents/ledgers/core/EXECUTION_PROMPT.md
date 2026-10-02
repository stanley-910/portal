# Core — Execution Prompt

`.agents/EXECUTE.md` is the prompt. Paste this:

```
Please execute @.agents/EXECUTE.md, do relevant tasks. I am <Ahmet|Cata>. If you face any
problems, /superpowers:brainstorm to fix and update the task/ledgers.
```

Ledger-specific guardrails:
- `types.ts` and `registry.ts` are written once in C01. Every later change is a new `C` task + ADR-C.
- Env vars are appended to `env.server.ts` / `.env.example` by adapter tasks, never renamed.
