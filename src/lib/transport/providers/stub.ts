import "server-only";
import { ProviderFailure, type Mode, type ProviderId, type SearchQuery, type TransportProvider } from "../types";

export function servesModes(modes: readonly Mode[], q: SearchQuery): boolean {
  return q.modes.length === 0 || q.modes.some((m) => modes.includes(m));
}

/** Placeholder until the provider's adapter task replaces its index.ts. */
export function stubProvider(id: ProviderId, modes: Mode[]): TransportProvider {
  return {
    id,
    modes,
    covers: (q) => servesModes(modes, q),
    search: async () => {
      throw new ProviderFailure("NOT_CONFIGURED");
    },
  };
}
