import { geocodePlaces } from "@/lib/places/photon";

// Online place search behind the bundled index. The client shows bundled matches first and treats
// any failure here as no extra results, so the globe never waits on it.
export const runtime = "nodejs";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 3 || q.length > 100) {
    return Response.json({ code: "BAD_QUERY", fields: ["q"] }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const places = await geocodePlaces(q, request.signal);
    return Response.json({ places }, { headers: { "Cache-Control": "public, max-age=86400" } });
  } catch (error) {
    if (!request.signal.aborted) console.error("PLACES_GEOCODE_FAILED", error);
    return Response.json({ code: "PLACES_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
