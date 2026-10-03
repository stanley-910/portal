import { describe, expect, it } from "vitest";

import { GET } from "./route";

const get = (qs: string) => GET(new Request(`http://localhost/api/entry?${qs}`));

describe("GET /api/entry", () => {
  it("resolves a leg with transport-search style params and ISO-2 countries", async () => {
    const res = await get("passport=US&fromIata=ICN&toIata=PVG&onwardCountry=JP");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ usesTransit: true, rule: { kind: "transit_exempt" } });
  });

  it("returns a country rule from toCountry alone", async () => {
    const body = await (await get("passport=HKG&toCountry=CN")).json();
    expect(body.rule.kind).toBe("entry_permit");
    expect(body.dataset.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("reports bad fields like the transport search", async () => {
    const res = await get("passport=U");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "BAD_QUERY", fields: ["passport", "toCountry"] });
  });
});
