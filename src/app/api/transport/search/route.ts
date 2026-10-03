import { searchFromCoordinates } from "@/lib/transport/hub-search";
import { parseSearchQuery } from "@/lib/transport/query";
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
  // Keep internal/provider failures out of the input-error classification.
  const result = await (resolution === "hubs" ? searchFromCoordinates : searchTransport)(parsed.data, request.signal);
  return Response.json(result, { headers });
}
