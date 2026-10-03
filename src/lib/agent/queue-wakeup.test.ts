import { afterEach, describe, expect, it, vi } from "vitest";
import { queuePollMs, readQueue, waitForQueue, wakeQueue } from "./queue-wakeup";
afterEach(() => vi.useRealTimers());
describe("Pip queue wakeups", () => {
  it("backs off to five seconds but wakes followers immediately on local completion", async () => {
    vi.useFakeTimers();
    expect([0, 1, 2, 20].map(queuePollMs)).toEqual([1500, 3000, 5000, 5000]);
    let woke = false;
    const pending = waitForQueue("room", 5000).then(() => { woke = true; });
    await vi.advanceTimersByTimeAsync(50);
    expect(woke).toBe(false);
    wakeQueue("room"); await pending;
    expect(woke).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("shares concurrent room reads, then fetches fresh state on the next poll", async () => {
    const load = vi.fn(async () => ({ thread: [] }));
    await Promise.all([readQueue("room", load), readQueue("room", load), readQueue("room", load)]);
    expect(load).toHaveBeenCalledTimes(1);
    await readQueue("room", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
