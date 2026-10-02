# Docs

Each area of the app has its own folder. Every folder has a `decisions.md`, plus any research or specs for that area.

| Folder | Covers |
|---|---|
| [foundation](foundation/decisions.md) | The stack, design tokens, fonts, and syncing with the design system |
| [globe](globe/decisions.md) | Globe interaction: zoom, pan, and the plane |
| [multiplayer](multiplayer/decisions.md) | The live layer, trip model, identity, the shared AI agent, and payments. Free-tier limits are in [free-tiers.md](multiplayer/free-tiers.md) |

When a new area needs a folder (`flights`, `trains`, `planner` and so on), add `docs/<area>/decisions.md` and a row here.

## Writing decisions

Each decision gets an ID (F1, G1, M1 and so on), a status, the decision itself, why we made it, and what it affects.

| Status | Meaning |
|---|---|
| `decided` | Agreed, but not built yet |
| `built` | In the code |
| `on hold` | Waiting on something |
| `superseded` | Replaced by another decision |

To reverse a decision, edit its entry: set it to `superseded` and link to the decision that replaces it. Don't delete it.

If a Linear ticket disagrees with a decision here, these docs win, and the ticket needs updating.
