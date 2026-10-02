---
category: Actions
---

# RoundButton

A 44px round icon button for the few actions that float over the globe or pin to a surface's corner.

- Provide `label` (its accessible name, e.g. "Cancel trip") and `onClick`.
- It is interface, not print: a `paper-raised` disc with a `control-border` outline, `shadow-float`, a `control-hover` fill on hover and a slight press.
- It carries the close glyph. Draw any future glyph the same way: an inline stroke SVG, 1.6px, in `currentColor`.
- Use it sparingly: the globe screen has no toolbar. Pin it to the corner of the surface it acts on, like the ticket's close button.
