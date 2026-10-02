import { parseSearchQuery } from "@/lib/transport/query";
import { fanOut } from "@/lib/transport/search";

// ADR-C01: provider keys stay server-side.
export const runtime = "nodejs";
// Providers run in parallel under PROVIDER_TIMEOUT_MS (8 s); headroom under Vercel's legacy 60 s cap.
export const maxDuration = 15;

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const parsed = parseSearchQuery(new URL(request.url).searchParams);
  if (!parsed.success) {
    return Response.json({ code: "BAD_QUERY", fields: parsed.fields }, { status: 400, headers });
  }
  const result = await fanOut(parsed.data, { signal: request.signal });
  return Response.json(result, { headers });
}
