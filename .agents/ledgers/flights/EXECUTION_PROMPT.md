# Flights — Execution Prompt

`.agents/EXECUTE.md` is the prompt:

```
Please execute @.agents/EXECUTE.md, do relevant tasks. I am Cata. If you face any
problems, /superpowers:brainstorm to fix and update the task/ledgers.
```

Guardrails: token only in header, only server-side. `kind: "cached"` always (ADR-F01).
