import { z } from "zod";

import { searchFromCoordinates } from "@/lib/transport/hub-search";
import { parseSearchQuery } from "@/lib/transport/query";
import { searchTransport } from "@/lib/transport/search";
import type { SearchQuery } from "@/lib/transport/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  let query: SearchQuery;
  const resolution = new URL(request.url).searchParams.get("resolve");
  if (resolution !== null && resolution !== "hubs") {
    return Response.json({ code: "BAD_QUERY" }, { status: 400 });
  }
  try {
    query = parseSearchQuery(request.url);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      return Response.json({ code: "BAD_QUERY" }, { status: 400 });
    }
    throw error;
  }
  // Keep provider/runtime failures out of the input-error catch above.
  const result = await (resolution === "hubs" ? searchFromCoordinates : searchTransport)(query, request.signal);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
