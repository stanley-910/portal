import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/transport/search", () => ({ searchTransport: vi.fn() }));
vi.mock("@/lib/transport/hub-search", () => ({ searchFromCoordinates: vi.fn() }));
import { searchTransport } from "@/lib/transport/search";
import { searchFromCoordinates } from "@/lib/transport/hub-search";
import { GET } from "./route";

function request(extra: Record<string, string> = {}) {
  const params = new URLSearchParams({
    from: JSON.stringify({ name: "Hong Kong", lat: 22.3, lng: 114.2 }),
    to: JSON.stringify({ name: "Shanghai", lat: 31.2, lng: 121.5 }),
    date: "2026-11-15", ...extra,
  });
  return new Request(`http://localhost/api/transport/search?${params}`);
}

beforeEach(() => vi.resetAllMocks());
describe("transport search route", () => {
  it.each<Record<string, string>>([{ from: "{" }, { date: "2026-02-30" }, { modes: "spaceship" }, { resolve: "anything" }])("returns safe 400 for invalid input %j", async (extra) => {
    const response = await GET(request(extra));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "BAD_QUERY" });
    expect(searchTransport).not.toHaveBeenCalled();
    expect(searchFromCoordinates).not.toHaveBeenCalled();
  });
  it("preserves the existing provider search contract by default", async () => {
    vi.mocked(searchTransport).mockResolvedValue({ offers: [], errors: [], tookMs: 0 });
    const req = request();
    const response = await GET(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(searchTransport).toHaveBeenCalledWith(expect.objectContaining({ modes: [] }), req.signal);
    expect(searchFromCoordinates).not.toHaveBeenCalled();
  });
  it("opts click queries into hub resolution without stripping clicked coordinates", async () => {
    vi.mocked(searchFromCoordinates).mockResolvedValue({ offers: [], errors: [], tookMs: 0, estimates: [], offerPairs: {}, hubs: {} } as never);
    const req = request({ resolve: "hubs" });
    const response = await GET(req);
    expect(response.status).toBe(200);
    expect(searchFromCoordinates).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: "Hong Kong", lat: 22.3, lng: 114.2 },
      to: { name: "Shanghai", lat: 31.2, lng: 121.5 },
    }), req.signal);
  });
  it("does not misclassify an internal SyntaxError as a client error", async () => {
    vi.mocked(searchTransport).mockRejectedValue(new SyntaxError("internal failure"));
    await expect(GET(request())).rejects.toThrow("internal failure");
  });
});
