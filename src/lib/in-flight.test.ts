import { describe, expect, it, vi } from "vitest";
import { createInFlight } from "./in-flight";

const reader = () => new AbortController();
describe("concurrent request sharing", () => {
  it("shares pending work, but never retains a completed quote", async () => {
    const share = createInFlight<number>();
    const work = vi.fn(async () => 7);
    const a = share("same", reader().signal, work), b = share("same", reader().signal, work);
    expect(await Promise.all([a, b])).toEqual([7, 7]);
    expect(work).toHaveBeenCalledTimes(1);
    await share("same", reader().signal, work);
    expect(work).toHaveBeenCalledTimes(2);
  });
  it("one reader's cancellation cannot kill another reader's request", async () => {
    const share = createInFlight<number>();
    let complete!: (n: number) => void;
    let signal!: AbortSignal;
    const work = vi.fn((s: AbortSignal) => { signal = s; return new Promise<number>((r) => { complete = r; }); });
    const a = reader(), b = reader();
    const first = share("same", a.signal, work), second = share("same", b.signal, work);
    await Promise.resolve();
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    a.abort();
    await rejected;
    expect(signal.aborted).toBe(false);
    complete(8);
    expect(await second).toBe(8);
    expect(signal.aborted).toBe(false);
  });
  it("the last departing reader cancels upstream, and an aborted request cannot start work", async () => {
    const share = createInFlight<number>();
    let signal!: AbortSignal;
    const work = vi.fn((s: AbortSignal) => { signal = s; return new Promise<number>(() => {}); });
    const a = reader();
    const first = share("same", a.signal, work);
    await Promise.resolve();
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    a.abort(); await rejected;
    expect(signal.aborted).toBe(true);
    await expect(share("other", a.signal, work)).rejects.toMatchObject({ name: "AbortError" });
    expect(work).toHaveBeenCalledTimes(1);
  });
  it("does not share different keys or evict active readers at capacity", async () => {
    const share = createInFlight<number>(1);
    const work = vi.fn(async () => 1);
    await Promise.all([share("a", reader().signal, work), share("b", reader().signal, work), share("a", reader().signal, work)]);
    expect(work).toHaveBeenCalledTimes(2);
  });
});
