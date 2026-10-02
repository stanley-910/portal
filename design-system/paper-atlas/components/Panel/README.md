---
category: Surfaces
---

# Panel

A floating interface surface over the globe: `paper-raised`, `radius-panel`, a `line` edge and `shadow-float`.

- Provide the content as children: usually a PlaceHeader, a divider, a short `body` paragraph and a row of Buttons.
- Pass `onClose` to pin a RoundButton to the top-right corner (accessible name via `closeLabel`).
- Put at most one primary Button in a panel.
- Panels are interface: never tilt them or give them the ticket's hard offset shadow. Keep the stamped look for the Ticket.
- Separate sections with a 1px `line` divider (`<div style="height:1px;background:var(--line)">`).
