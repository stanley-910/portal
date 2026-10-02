import type { ProviderResult } from "../../../src/lib/entry/schema.ts";

export interface ProviderContext {
  pairs: { passport: string; destination: string }[];
  destinations: { code: string; govukSlug?: string }[];
  /** Highest number of network requests the provider may make in this run. */
  maxRequests: number;
  cacheDir: string;
  log: (message: string) => void;
}

/** A build-time source of entry information. Never called at request time. */
export interface EntryProvider {
  id: string;
  /** Short reason the provider can't run (missing key etc.), or undefined when it can. */
  unavailable?(): string | undefined;
  run(ctx: ProviderContext): Promise<ProviderResult[]>;
}
