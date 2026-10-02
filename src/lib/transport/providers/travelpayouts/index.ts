import "server-only";

import { env } from "@/lib/env.server";

import { getPrices } from "./client";
import { estimateFlight } from "./estimate";
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
    const origin = toIata(query.from);
    const destination = toIata(query.to);
    if (!origin || !destination) throw new ProviderFailure("UNSUPPORTED_ROUTE");
    const estimate = () => estimateFlight(query, origin, destination, env.TRAVELPAYOUTS_MARKER);
    // without a token or a working API the leg still gets an estimate: the demo can't depend on a flaky API
    if (!env.TRAVELPAYOUTS_TOKEN) return estimate();
    try {
      const offers = mapFlights(await getPrices(query, origin, destination, signal), query, env.TRAVELPAYOUTS_MARKER);
      return offers.length ? offers : estimate();
    } catch (error) {
      if (signal.aborted) throw error;
      console.warn({ provider: "travelpayouts", error: error instanceof Error ? error.message : String(error) }, "FELL_BACK_TO_ESTIMATE");
      return estimate();
    }
  },
};

export default travelpayouts;
