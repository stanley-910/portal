import { describe, expect, it, vi } from "vitest";
import { readSoloEvents } from "./solo-stream";

describe("solo reply stream lifecycle", () => {
  it("decodes split unicode and the final unterminated event in order", async () => {
    const bytes = new TextEncoder().encode('{"t":"text","d":"東京"}\n{"t":"done"}');
    const body = new ReadableStream<Uint8Array>({ start(c) { for (const b of bytes) c.enqueue(Uint8Array.of(b)); c.close(); } });
    const seen: unknown[] = [];
    await readSoloEvents(body, new AbortController().signal, (event) => seen.push(event));
    expect(seen).toEqual([{ t: "text", d: "東京" }, { t: "done" }]);
    expect(body.locked).toBe(false);
  });
  it("Stop releases a blocked read and prevents later trip mutations", async () => {
    const cancel = vi.fn();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(c) { source = c; }, cancel });
    const ctrl = new AbortController();
    const apply = vi.fn();
    const pending = readSoloEvents(body, ctrl.signal, apply);
    source.enqueue(new TextEncoder().encode('{"t":"text","d":"hello"}\n'));
    await Promise.resolve();
    ctrl.abort();
    await pending;
    expect(cancel).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });
  it("an already-aborted request never applies queued events", async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"t":"trip","legs":[]}\n')); } });
    const ctrl = new AbortController(); ctrl.abort();
    const apply = vi.fn();
    await readSoloEvents(body, ctrl.signal, apply);
    expect(apply).not.toHaveBeenCalled();
  });
  it("reports malformed partial streams, releasing their readers", async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{broken}\n')); } });
    await expect(readSoloEvents(body, new AbortController().signal, () => {})).rejects.toThrow();
    expect(body.locked).toBe(false);
  });
});
