import type { SoloEvent } from "@/lib/agent/solo";

/** Read complete NDJSON events, including a final line without newline. Stop owns and cancels the reader. */
export async function readSoloEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal, apply: (event: SoloEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const line = (text: string) => { if (!signal.aborted && text.trim()) apply(JSON.parse(text) as SoloEvent); };
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) { line(buffer.slice(0, at)); buffer = buffer.slice(at + 1); }
    }
    line(buffer + decoder.decode());
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
