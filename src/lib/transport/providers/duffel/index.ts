import "server-only";

import { requestOffers } from "./client";
import { mapOffers } from "./map";
import { toIata } from "../travelpayouts/places";
import { ProviderFailure, type SearchQuery, type TransportProvider } from "../../types";

// Live flight offers that can be booked through Duffel later. Without a token it reports NOT_CONFIGURED and
// Travelpayouts' cached fares and estimates still cover every flight leg.
export const duffel: TransportProvider = {
  id: "duffel",
  modes: ["flight"],
  covers(query: SearchQuery) {
    const origin = toIata(query.from);
    const destination = toIata(query.to);
    return (query.modes.length === 0 || query.modes.includes("flight")) &&
      origin !== null && destination !== null && origin !== destination;
  },
  async search(query, signal) {
    const origin = toIata(query.from);
    const destination = toIata(query.to);
    if (!origin || !destination || origin === destination) throw new ProviderFailure("UNSUPPORTED_ROUTE");
    const raw = await requestOffers(query, origin, destination, signal);
    signal.throwIfAborted();
    return mapOffers(raw, query, origin, destination);
  },
};

export default duffel;
