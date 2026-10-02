# Trains — Execution Prompt

`.agents/EXECUTE.md` is the prompt:

```
Please execute @.agents/EXECUTE.md, do relevant tasks. I am Ahmet. If you face any
problems, /superpowers:brainstorm to fix and update the task/ledgers.
```

Guardrails: TDX quota (ADR-T01) — never call TDX in a loop or per-stop. No 12306 at request time (ADR-T02).
