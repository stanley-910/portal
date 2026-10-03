import { z } from "zod";

import { runSolo, type SoloEvent } from "@/lib/agent/solo";
import { getAccountClaims } from "@/lib/supabase/server";

// Pip on the home globe: one reply, streamed back as lines of JSON (lib/agent/solo.ts). No trip room and no session:
// the browser holds the conversation and the legs on its globe. Asking Pip needs an account.

export const runtime = "nodejs";
// a reply runs for up to TIMEOUT_MS (80 s, lib/agent/solo.ts); a model that fails late still gets the no-model answer
export const maxDuration = 120;

const MAX_TEXT = 2_000;
const MAX_HISTORY = 16;

// Per person, kept in memory, so per server instance and reset on deploy: enough to stop one person hammering the
// model, not a quota. Trip rooms have their own daily cap per trip (lib/agent/run.ts).
const PER_MINUTE = 8;
const PER_DAY = 80;
const recent = new Map<string, number[]>();
function allow(personId: string, now = Date.now()) {
  const times = (recent.get(personId) ?? []).filter((t) => now - t < 86_400_000);
  if (times.filter((t) => now - t < 60_000).length >= PER_MINUTE || times.length >= PER_DAY) return false;
  recent.set(personId, [...times, now]);
  if (recent.size > 5_000) recent.delete(recent.keys().next().value!);
  return true;
}

const stop = z.object({
  name: z.string().min(1).max(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  hub: z.string().max(64).nullable().default(null),
  code: z.string().max(8).nullable().optional(),
});
const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(MAX_TEXT) }))
    .min(1)
    .max(MAX_HISTORY)
    .refine((m) => m.at(-1)?.role === "user", "the last message is the person's"),
  trip: z.array(z.object({ from: stop, to: stop, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).max(8).default([]),
});

export async function POST(request: Request) {
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ code: "BAD_REQUEST" }, { status: 400 });
  // the token's claims, not a profile lookup: every message pays for this check before Pip can start
  const person = await getAccountClaims();
  if (!person) return Response.json({ code: "SIGN_IN" }, { status: 401 });
  if (!allow(person.id)) return Response.json({ code: "RATE_LIMITED" }, { status: 429, headers: { "retry-after": "60" } });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: SoloEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // the reader went away
        }
      };
      await runSolo({ ...body.data, name: person.name, nationalities: person.nationalities }, emit, request.signal);
      try {
        controller.close();
      } catch {}
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
