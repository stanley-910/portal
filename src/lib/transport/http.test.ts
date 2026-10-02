import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, fetchText } from "./http";
import { ProviderFailure, type ProviderErrorCode } from "./types";

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function failure(p: Promise<unknown>): Promise<ProviderFailure> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ProviderFailure);
  return err as ProviderFailure;
}

const signal = () => AbortSignal.timeout(5_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    stubFetch(async () => {
      throw new DOMException("signal timed out", "TimeoutError");
    });
    const err = await failure(fetchJson("https://x.test/a", { signal: signal() }));
    expect(err.code).toBe("TIMEOUT");
    expect(err.retryable).toBe(true);
  });

  it("maps caller abort to TIMEOUT", async () => {
    const ctrl = new AbortController();
    stubFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const p = fetchJson("https://x.test/a", { signal: ctrl.signal });
    ctrl.abort();
    const err = await failure(p);
    expect(err.code).toBe("TIMEOUT");
  });

  it("maps network failure to retryable UPSTREAM_ERROR", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const err = await failure(fetchJson("https://x.test/a", { signal: signal() }));
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(err.retryable).toBe(true);
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
