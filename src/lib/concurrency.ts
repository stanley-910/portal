/** A request-scoped limit. Queued work rechecks cancellation before using a provider slot. */
export function createLimiter(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (running >= limit) await new Promise<void>((resolve, reject) => {
      const ready = () => { signal?.removeEventListener("abort", abort); resolve(); };
      const abort = () => {
        const at = waiting.indexOf(ready);
        if (at >= 0) waiting.splice(at, 1);
        reject(signal?.reason);
      };
      waiting.push(ready);
      signal?.addEventListener("abort", abort, { once: true });
    });
    else running++;
    try { signal?.throwIfAborted(); return await work(); }
    finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}
