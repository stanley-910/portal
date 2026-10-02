import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchJson, fetchText } from "./http";

const url = "https://provider.invalid/data";
afterEach(() => { vi.unstubAllGlobals(); });

describe("provider HTTP boundary (offline fetch stubs)", () => {
  it.each([
    [401, "AUTH_FAILED", false],
    [403, "AUTH_FAILED", false],
    [429, "RATE_LIMITED", true],
    [500, "UPSTREAM_ERROR", true],
    [503, "UPSTREAM_ERROR", true],
    [400, "UPSTREAM_ERROR", false],
    [404, "UPSTREAM_ERROR", false],
    [302, "UPSTREAM_ERROR", false],
  ])("maps status %s without leaking the body", async (status, code, retryable) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("secret-provider-error", { status })));
    await expect(fetchJson(url)).rejects.toMatchObject({ code, retryable, message: code });
  });

  it("passes request headers, cancellation and Next revalidation options through", async () => {
    const fetch = vi.fn(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetch);
    const options = { signal: new AbortController().signal, headers: { "X-Access-Token": "test-only" }, next: { revalidate: 86400 } };
    expect(await fetchJson(url, options)).toEqual({ data: [] });
    expect(fetch).toHaveBeenCalledWith(url, options);
  });

  it("reads text without assuming JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("a timetable")));
    expect(await fetchText(url)).toBe("a timetable");
  });

  it("maps invalid JSON to BAD_RESPONSE", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("secret invalid JSON")));
    await expect(fetchJson(url)).rejects.toMatchObject({ code: "BAD_RESPONSE", retryable: false, message: "BAD_RESPONSE" });
  });

  it("maps transport errors without leaking authenticated URLs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed https://secret-token.invalid"); }));
    await expect(fetchJson(url)).rejects.toMatchObject({ code: "UPSTREAM_ERROR", retryable: true, message: "UPSTREAM_ERROR" });
  });

  it.each(["AbortError", "TimeoutError"])("maps fetch %s to TIMEOUT", async (name) => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("private reason", name); }));
    await expect(fetchJson(url)).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it.each(["json", "text"] as const)("maps abort during %s body consumption to TIMEOUT", async (method) => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      [method]: async () => { throw new DOMException("private reason", "AbortError"); },
    })));
    await expect(method === "json" ? fetchJson(url) : fetchText(url)).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("recognizes arbitrary abort reasons through the supplied signal", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => {
      controller.abort("private reason");
      throw "private reason";
    }));
    await expect(fetchJson(url, { signal: controller.signal })).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });
});
