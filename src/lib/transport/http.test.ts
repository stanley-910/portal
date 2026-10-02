import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, fetchText } from "./http";
import { ProviderFailure, type ProviderErrorCode } from "./types";

const url = "https://provider.invalid/data";
const signal = () => AbortSignal.timeout(5_000);

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function failure(p: Promise<unknown>): Promise<ProviderFailure> {
  const err = await p.then(() => undefined, (e: unknown) => e);
  expect(err).toBeInstanceOf(ProviderFailure);
  return err as ProviderFailure;
}

afterEach(() => { vi.unstubAllGlobals(); });

// HEAD boundary hardening coverage.
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
    vi.stubGlobal("fetch", vi.fn(async () => new Response("secret-provider-error", { status: status as number })));
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

// Incoming API-contract coverage, retained alongside the hardening suite.
describe("fetchJson", () => {
  it("returns parsed body on 200", async () => {
    stubFetch(async () => Response.json({ ok: true }));
    await expect(fetchJson("https://x.test/a", { signal: signal() })).resolves.toEqual({ ok: true });
  });

  it("passes headers, method, body and signal through", async () => {
    const fn = stubFetch(async () => Response.json({}));
    const s = signal();
    await fetchJson("https://x.test/a", { signal: s, method: "POST", headers: { "X-Access-Token": "t" }, body: "a=1" });
    const init = fn.mock.calls[0][1];
    expect(init?.signal).toBe(s);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("a=1");
    expect(new Headers(init?.headers).get("X-Access-Token")).toBe("t");
  });

  it.each<[number, ProviderErrorCode, boolean]>([
    [401, "AUTH_FAILED", false],
    [403, "AUTH_FAILED", false],
    [429, "RATE_LIMITED", true],
    [500, "UPSTREAM_ERROR", true],
    [502, "UPSTREAM_ERROR", true],
    [503, "UPSTREAM_ERROR", true],
    [404, "UPSTREAM_ERROR", false],
  ])("maps HTTP %i to %s (retryable %s)", async (status, code, retryable) => {
    stubFetch(async () => new Response("nope", { status }));
    const err = await failure(fetchJson("https://x.test/a", { signal: signal() }));
    expect(err.code).toBe(code);
    expect(err.retryable).toBe(retryable);
  });

  it("maps unparseable body to BAD_RESPONSE", async () => {
    stubFetch(async () => new Response("<html>", { status: 200 }));
    const err = await failure(fetchJson("https://x.test/a", { signal: signal() }));
    expect(err.code).toBe("BAD_RESPONSE");
    expect(err.retryable).toBe(false);
  });

  it("maps timeout abort to TIMEOUT", async () => {
    stubFetch(async () => { throw new DOMException("signal timed out", "TimeoutError"); });
    const err = await failure(fetchJson("https://x.test/a", { signal: signal() }));
    expect(err.code).toBe("TIMEOUT");
    expect(err.retryable).toBe(true);
  });

  it("maps caller abort to TIMEOUT", async () => {
    const ctrl = new AbortController();
    stubFetch((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const p = fetchJson("https://x.test/a", { signal: ctrl.signal });
    ctrl.abort();
    const err = await failure(p);
    expect(err.code).toBe("TIMEOUT");
  });

  it("maps network failure to retryable UPSTREAM_ERROR", async () => {
    stubFetch(async () => { throw new TypeError("fetch failed"); });
    const err = await failure(fetchJson("https://x.test/a", { signal: signal() }));
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(err.retryable).toBe(true);
  });

  it("cancels error-response bodies without exposing them", async () => {
    const cancel = vi.fn(async () => {});
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429, body: { cancel } })));
    await expect(fetchJson(new URL(url))).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("maps body transport failures to retryable UPSTREAM_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, json: async () => { throw new TypeError("secret truncated body"); },
    })));
    await expect(fetchJson(url)).rejects.toMatchObject({ code: "UPSTREAM_ERROR", retryable: true, message: "UPSTREAM_ERROR" });
  });
});

describe("fetchText", () => {
  it("returns raw body on 200", async () => {
    stubFetch(async () => new Response("<xml/>", { status: 200 }));
    await expect(fetchText("https://x.test/a", { signal: signal() })).resolves.toBe("<xml/>");
  });

  it("maps status codes like fetchJson", async () => {
    stubFetch(async () => new Response("", { status: 429 }));
    const err = await failure(fetchText("https://x.test/a", { signal: signal() }));
    expect(err.code).toBe("RATE_LIMITED");
  });
});
