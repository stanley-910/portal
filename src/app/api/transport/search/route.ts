import { searchFromCoordinates, type HubSearchResult } from "@/lib/transport/hub-search";
import { NEAR_HEADER, parseNear } from "@/lib/transport/near";
import { parseSearchQuery } from "@/lib/transport/query";
import type { TransportSearchEvent } from "@/lib/transport/stream";
import { searchTransport } from "@/lib/transport/search";

// Provider keys stay server-side. The longest provider deadline (Duffel's 10 s) leaves headroom below this cap, and a
// provider past its deadline still answers with its estimates, so the route never times out into an empty card.
export const runtime = "nodejs";
export const maxDuration = 15;
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const resolution = params.get("resolve");
  if (resolution !== null && resolution !== "hubs") {
    return Response.json({ code: "BAD_QUERY", fields: ["resolve"] }, { status: 400, headers });
  }
  const parsed = parseSearchQuery(params);
  if (!parsed.success) {
    return Response.json({ code: "BAD_QUERY", fields: parsed.fields }, { status: 400, headers });
  }
  // where the person searching is, from a header rather than the URL so it stays out of logs; it only ranks airports
  const near = parseNear(request.headers.get(NEAR_HEADER));
  if (near) parsed.data.near = near;
  if (params.get("stream") === "1" && resolution === "hubs") {
    const stopped = new AbortController();
    const signal = AbortSignal.any([request.signal, stopped.signal]);
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => { clearTimeout(timer); timer = undefined; };
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: TransportSearchEvent) => {
          if (signal.aborted) return;
          try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); }
          catch { stopped.abort(); }
        };
        let pending: HubSearchResult | undefined;
        let sentUseful = false;
        const flush = () => {
          clear();
          if (!pending) return;
          sentUseful ||= pending.offers.length > 0;
          emit({ t: "result", result: pending, done: false });
          pending = undefined;
        };
        const progress = (result: HubSearchResult) => {
          if (signal.aborted) return;
          pending = result;
          // First usable fares are immediate. Afterwards, collapse local provider bursts and cap snapshots at 20 Hz.
          if (!sentUseful && result.offers.length) flush();
          else timer ??= setTimeout(flush, 50);
        };
        signal.addEventListener("abort", clear, { once: true });
        try {
          const result = await searchFromCoordinates(parsed.data, signal, progress);
          clear();
          emit({ t: "result", result, done: true });
        } catch {
          emit({ t: "failed" });
        } finally {
          clear();
          signal.removeEventListener("abort", clear);
          try { controller.close(); } catch {}
        }
      },
      cancel() { clear(); stopped.abort(); },
    });
    return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no" } });
  }
  // Keep internal/provider failures out of the input-error classification.
  const result = await (resolution === "hubs" ? searchFromCoordinates : searchTransport)(parsed.data, request.signal);
  return Response.json(result, { headers });
}
