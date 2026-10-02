---
category: Live
---

# Cursor

Another trip member's pointer: a sticker cut from their colour of paper, with their name on a small label beside it.

- Provide `color` (from `memberColor(slot)`, e.g. a Liveblocks connectionId) and `x`, `y` (the tip, in px, relative to a positioned parent). Pass `name` to show the label.
- `shape` is `arrow` (default; reads best at cursor size), `compass` (a needle with a coloured north half) or `map` (the arrow folded like a road map). Use one shape for everyone in a room.
- The tip is the hotspot. Like every sticker it has no cut border, keeps its paper colours in both themes, and casts a shadow down and to the right.
- `altitude` (0 to 1, default 0.5) sets how far off and soft that shadow falls. Cursor and label cast it together. Over a textured globe, feed it the terrain height so the shadow closes in on mountain tops.
- The name label uses the `tag` style in `sticker-ink` on the member's colour, tilted −1.2°. Jade, cornflower and orchid share a lightness, so the name, not the hue, tells members apart.
- Remote cursors ease between updates over 90ms; under reduced motion they jump.
- Never use the `member-*` colours for anything but a member's cursor and name label.
