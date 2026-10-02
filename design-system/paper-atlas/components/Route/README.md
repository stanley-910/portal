---
category: Trip
---

# Route

A dashed ink arc between two places, for flat layouts such as the ticket and lists.

- Provide `width` and `height`. `lift` sets how high the arc rises (0 is flat, 1 is a full arc).
- Set `marching` while a search for that route is running, and only then.
- On the globe itself, draw the route as a great-circle arc in the globe's own renderer instead (see Stickers and the route in the brand book). Use the same `ink`, `line-route` and `dash-route`.
