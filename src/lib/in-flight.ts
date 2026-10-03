/** Shares only concurrent work, never a completed quote. Each reader keeps independent cancellation. */
export function createInFlight<T>(maxEntries = 256) {
  type Entry = { controller: AbortController; promise: Promise<T>; readers: number; settled: boolean };
  const entries = new Map<string, Entry>();
  return (key: string, signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    if (signal.aborted) return Promise.reject(signal.reason);
    let entry = entries.get(key);
    if (!entry || entry.controller.signal.aborted) {
      const controller = new AbortController();
      const created: Entry = { controller, readers: 0, settled: false, promise: Promise.resolve().then(() => work(controller.signal)) };
      entry = created;
      // At capacity, run independently rather than evicting another reader's active work.
      if (entries.size < maxEntries) entries.set(key, created);
      const forget = () => { created.settled = true; if (entries.get(key) === created) entries.delete(key); };
      void created.promise.then(forget, forget);
    }
    const active = entry;
    active.readers++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const finish = (done: () => void) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", onAbort);
        if (--active.readers === 0) {
          if (entries.get(key) === active) entries.delete(key);
          if (!active.settled) active.controller.abort();
        }
        done();
      };
      const onAbort = () => finish(() => reject(signal.reason));
      signal.addEventListener("abort", onAbort, { once: true });
      void active.promise.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
      if (signal.aborted) onAbort();
    });
  };
}
