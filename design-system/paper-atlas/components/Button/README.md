---
category: Actions
---

# Button

The interface button: Barlow Semi Condensed on a soft-cornered control, with a clear hover and press.

- Provide the label as children, a verb plus its object in sentence case (`Search flights`). Optionally pass `icon` (a 16px inline stroke SVG) and `onClick`.
- `variant="primary"` (ink fill) for the one main action in a view. `secondary` (outlined, on `paper-raised`) for alternatives. `quiet` (text only) for low-stakes actions like "Clear".
- Use `block` inside narrow panels so the button spans the panel.
- An icon-only button needs `aria-label`; prefer RoundButton for those over the globe.
- Do not tilt, stamp or put hard offset shadows on buttons. Those belong to the ticket and tags.
