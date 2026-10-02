import "server-only";

import { env } from "@/lib/env.server";

import { getPrices } from "./client";
import { mapFlights } from "./map";
import { toIata } from "./places";
import { ProviderFailure, type SearchQuery, type TransportProvider } from "../../types";

export const travelpayouts: TransportProvider = {
  id: "travelpayouts",
  modes: ["flight"],
  covers(query: SearchQuery) {
    return (query.modes.length === 0 || query.modes.includes("flight")) &&
      toIata(query.from) !== null &&
      toIata(query.to) !== null;
  },
  async search(query, signal) {
    if (!env.TRAVELPAYOUTS_TOKEN) throw new ProviderFailure("NOT_CONFIGURED");
    const origin = toIata(query.from);
    const destination = toIata(query.to);
    if (!origin || !destination) throw new ProviderFailure("UNSUPPORTED_ROUTE");
    try {
      return mapFlights(await getPrices(query, origin, destination, signal), query, env.TRAVELPAYOUTS_MARKER);
    } catch (error) {
      if (error instanceof ProviderFailure) throw error;
      if (error instanceof Error && error.message === "NOT_CONFIGURED") {
        throw new ProviderFailure("NOT_CONFIGURED");
      }
      if (error instanceof Error && error.message === "BAD_RESPONSE") {
        throw new ProviderFailure("BAD_RESPONSE");
      }
      throw error;
    }
  },
};

export default travelpayouts;
