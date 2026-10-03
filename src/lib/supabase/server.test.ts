import { beforeEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ getUser: vi.fn(), getClaims: vi.fn(), from: vi.fn(), abortSignal: vi.fn(), profile: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: mocked.getUser, getClaims: mocked.getClaims }, from: mocked.from }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("./config", () => ({ supabaseConfig: () => ({ url: "https://fixture.invalid", key: "fixture" }) }));
import { getAccountClaims, getCurrentUser } from "./server";
beforeEach(() => {
  vi.clearAllMocks();
  const query = { select: () => query, eq: () => query, abortSignal: mocked.abortSignal, maybeSingle: mocked.profile };
  mocked.from.mockReturnValue(query);
  mocked.abortSignal.mockReturnValue(query);
});
describe("display claims versus mutation identity", () => {
  it("reads verified display claims without a remote user/profile lookup", async () => {
    mocked.getClaims.mockResolvedValue({ data: { claims: { sub: "u", email: "ana@example.com", user_metadata: { display_name: "Ana", color: 2, nationalities: ["CAN"] } } } });
    expect(await getAccountClaims()).toMatchObject({ id: "u", name: "Ana", color: 2, nationalities: ["CAN"] });
    expect(mocked.getUser).not.toHaveBeenCalled(); expect(mocked.from).not.toHaveBeenCalled();
  });
  it("still verifies mutations remotely and does not accept invalid users", async () => {
    mocked.getUser.mockResolvedValue({ data: { user: null }, error: { message: "revoked" } });
    expect(await getCurrentUser()).toBeNull();
    expect(mocked.getUser).toHaveBeenCalledTimes(1); expect(mocked.getClaims).not.toHaveBeenCalled();
  });
  it("bounds optional profile enrichment and retains metadata when a profile is unavailable", async () => {
    mocked.getUser.mockResolvedValue({ data: { user: { id: "u", email: "ana@example.com", user_metadata: { display_name: "Ana" } } } });
    mocked.profile.mockResolvedValue({ data: null, error: { message: "timeout" } });
    expect(await getCurrentUser()).toMatchObject({ id: "u", displayName: "Ana" });
    expect(mocked.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it.each([new DOMException("Profile deadline", "TimeoutError"), new Error("Profile network failed")])("retains remotely verified identity when profile enrichment throws %s", async (error) => {
    mocked.getUser.mockResolvedValue({ data: { user: { id: "u", email: "ana@example.com", user_metadata: { display_name: "Ana", color: 2, nationalities: ["CAN"] } } } });
    mocked.profile.mockRejectedValue(error);
    expect(await getCurrentUser()).toEqual({ id: "u", email: "ana@example.com", displayName: "Ana", color: 2, nationalities: ["CAN"] });
    expect(mocked.getUser).toHaveBeenCalledTimes(1);
    expect(mocked.getClaims).not.toHaveBeenCalled();
  });

});
