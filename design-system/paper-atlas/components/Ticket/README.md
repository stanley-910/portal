---
category: Trip
---

# Ticket

The result of a trip: origin and destination codes with their cities, the departure date and the distance, while a search runs.

- Provide `from` and `to` (`{ code, city }`), `date` as shown (`'Sat 3 Oct'`), and `distance` (`'9,624 km'`).
- Pass `onClose` to show the round close button at the top-right corner. Its accessible name defaults to "Cancel trip".
- Leave `searching` on while results load: the route dashes march and the three dots bob. Set it to `false` once results arrive.
- Place one ticket per screen, bottom-centre, `space-6` from the bottom edge. It is tilted −1.2° by default. Use `flat` when tickets sit in a list.
- Do not add more fields to the stub. Put prices, times and airlines in the results, not on the ticket.
