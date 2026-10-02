# Buses — Recommended Model Per Task

| ID | Title | Model | Why |
|----|-------|-------|-----|
| B01 | Taiwan intercity bus seed (`tdx` provider) | `claude-sonnet-5-5` | Hand-curated seed + mapper beside T06 THSR seed (ADR-B07) |
| B02 | Korea express bus seed (`korea-tago` provider) | `claude-sonnet-5-5` | Hand-curated seed + mapper on T03 loader (ADR-B07) |
| B03 | GTFS build pipeline + gtfs adapter | `claude-opus-5-5` | Non-standard namtang, timezones, >24h times, big files |
| B04 | 12Go bus route seed | `claude-sonnet-5-5` | Data + tests on S02 adapter |
| B05 | BusOnlineTicket seed + deep links | `claude-sonnet-5-5` | Data + URLs |

Never haiku.
