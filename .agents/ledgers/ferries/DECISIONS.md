# Ferries — Decisions (append-only ADR log)

Prefix `ADR-S`. Never edit past entries.

---

## ADR-S01 — 2026-10-02 — 12Go is link-out only; route data is our own seed

**Context:** Team assumed "12Go Asia API free". Doc `12go.md`: API needs 12Go prior consent +
confidential terms; Travelier Connect is sales-only B2B. Options: (A) wait for API (B) scrape
(C) own seed + deep link.
**Decision:** (C). `ferry-routes.json` curated from operator sites/public timetables; `Offer.kind
= "timetable"`, no `price`, `bookingUrl` = 12Go route page.
**Why not (B):** affiliate agreement bans copying 12Go products; robots.txt disallows; bot-challenged (observed 202 empty).
**Why not (A):** unknown timeline; keep as backlog.
**Consequences:** coverage = what we curate. UI copy must not imply live prices.

## ADR-S02 — 2026-10-02 — `providers/12go/` shared, generic over mode

**Context:** Ferries (Cata) and buses (Ahmet) both route to 12Go. Two adapters = duplicate links/match code + registry conflict.
**Decision:** S02 writes generic `index.ts` loading `<mode>-routes.json`. Bus ledger only adds `bus-routes.json` + tests.
**Consequences:** B-task depends on S02. Seed schema change = ADR-S entry, both seats agree.
