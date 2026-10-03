# TDX contract fixtures

`official-contract.json` is an unmodified excerpt of the official OpenAPI 3 document retrieved 2026-10-03 from
https://tdx.transportdata.tw/webapi/File/Swagger/V3/268fc230-2e04-471b-a728-a726167c1cfc . The operator page's own
`/webapi/serviceCategory/ForSwagger` identifies this group as rail v2; its public frontend loads the document via
`/webapi/File/Swagger/V3/{id}`. The `V3` in the document URL describes the OpenAPI format, not the rail endpoint version.

`daily-contract.json` is **synthetic test data conforming to that contract**, not a recording of actual train times
or an authorized live response. It deliberately distinguishes arrival from departure. No authenticated smoke call
has succeeded because no TDX credentials were available. These times must never be bundled as production fallback.
