# Flights — Recommended Model Per Task

| ID | Title | Model | Why |
|----|-------|-------|-----|
| F01 | Travelpayouts `prices_for_dates` adapter | `claude-sonnet-5-5` | Mapper over documented JSON |
| F02 | Place → IATA resolver from airports/cities snapshot | `claude-sonnet-5-5` | Static data + nearest-point lookup |
| F03 | Aviasales deep links with marker | `claude-sonnet-5-5` | URL building + optional links API |

Rule: mapper/wiring = sonnet. Never haiku.
