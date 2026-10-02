# Trains — Recommended Model Per Task

| ID | Title | Model | Why |
|----|-------|-------|-----|
| T01 | TDX OAuth client + THSR adapter | `claude-opus-5-5` | Token cache + quota discipline shared with buses; tight limits |
| T02 | TDX TRA adapter | `claude-sonnet-5-5` | Same client, second mapper |
| T03 | Korea TAGO client + KTX adapter | `claude-sonnet-5-5` | Mapper; key-encoding trap documented |
| T04 | China rail seed + affiliate link-out | `claude-sonnet-5-5` | Static data + URLs |
| T05 | GTFS rail pairs (KTMB, SRT) | `claude-sonnet-5-5` | Filter over B03 pipeline |

Never haiku.
