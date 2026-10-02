import "server-only";

import { Liveblocks, LiveblocksError } from "@liveblocks/node";

let client: Liveblocks | null = null;

/** The Liveblocks server client. Throws if LIVEBLOCKS_SECRET_KEY is missing, so a misconfigured deploy fails loudly. */
export function liveblocks() {
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  if (!secret?.startsWith("sk_")) {
    throw new Error("LIVEBLOCKS_SECRET_KEY is missing or not a secret key. Add it to .env.local (see README).");
  }
  client ??= new Liveblocks({ secret });
  return client;
}

export const isNotFound = (e: unknown) => e instanceof LiveblocksError && e.status === 404;
