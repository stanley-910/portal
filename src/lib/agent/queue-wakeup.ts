import { createInFlight } from "@/lib/in-flight";

/** In one server instance, followers share simultaneous queue reads and wake when the active reply completes.
 * The bounded poll remains for completions on other instances and dead-run recovery. */
const waiters = new Map<string, Set<() => void>>();
export function wakeQueue(room: string) {
  for (const wake of waiters.get(room) ?? []) wake();
}
export function waitForQueue(room: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const roomWaiters = waiters.get(room) ?? new Set<() => void>();
    waiters.set(room, roomWaiters);
    const done = () => {
      clearTimeout(timer);
      roomWaiters.delete(done);
      if (!roomWaiters.size) waiters.delete(room);
      resolve();
    };
    const timer = setTimeout(done, ms);
    roomWaiters.add(done);
  });
}
export const queuePollMs = (attempt: number) => Math.min(5_000, 1_500 * 2 ** Math.min(2, attempt));
const shared = createInFlight<unknown>();
export function readQueue<T>(room: string, read: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return shared(room, AbortSignal.timeout(5_000), read) as Promise<T>;
}
