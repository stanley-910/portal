# Buses — Recommended Model Per Task

| ID | Title | Model | Why |
|----|-------|-------|-----|
| B01 | TDX intercity bus via stop-pair index | `claude-opus-5-5` | Join across routes under 5 req/min budget |
| B02 | Korea express + intercity bus | `claude-sonnet-5-5` | Mapper on T03 client |
| B03 | GTFS build pipeline + gtfs adapter | `claude-opus-5-5` | Non-standard namtang, timezones, >24h times, big files |
| B04 | 12Go bus route seed | `claude-sonnet-5-5` | Data + tests on S02 adapter |
| B05 | BusOnlineTicket seed + deep links | `claude-sonnet-5-5` | Data + URLs |

Never haiku.
