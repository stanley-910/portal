import "server-only";

import { env } from "@/lib/env.server";

import { getPrices } from "./client";
import { mapFlights } from "./map";
import { toIata } from "./places";
import { ProviderFailure, type SearchQuery, type TransportProvider } from "../../types";

export const travelpayouts: TransportProvider = {
  id: "travelpayouts",
  modes: ["flight"],
  // Eligibility to ask the cache is not evidence of a route or seat availability.
  covers(query: SearchQuery) {
    const origin = toIata(query.from);
    const destination = toIata(query.to);
    return (query.modes.length === 0 || query.modes.includes("flight")) &&
      origin !== null && destination !== null && origin !== destination;
  },
  async search(query, signal) {
    if (!env.TRAVELPAYOUTS_TOKEN) throw new ProviderFailure("NOT_CONFIGURED");
    const origin = toIata(query.from);
    const destination = toIata(query.to);
    if (!origin || !destination || origin === destination) throw new ProviderFailure("UNSUPPORTED_ROUTE");
    return mapFlights(await getPrices(query, origin, destination, signal), query, env.TRAVELPAYOUTS_MARKER);
  },
};
