import "server-only";
import { ProviderFailure, type Mode, type SearchQuery, type TransportProvider } from "../../types";
import { servesModes } from "../stub";
import type { TrainSeed } from "./schema";
import { trainSeed } from "./seed";
import { createTrainSearch } from "./train";

// Korea = hand-curated seed, no data.go.kr calls (ADR-T05). Provider id stays `korea-tago`.
// B02 adds a bus search beside the train one: extend MODES and the dispatch below.
const TRAIN: Mode[] = ["train"];

export function createKoreaTagoProvider(seeds: { train: TrainSeed }): TransportProvider {
  const train = createTrainSearch(seeds.train);
  const trainCovers = (q: SearchQuery) => servesModes(TRAIN, q) && train.covers(q);

  return {
    id: "korea-tago",
    modes: [...TRAIN],
    covers: trainCovers,
    async search(q) {
      if (!trainCovers(q)) throw new ProviderFailure("UNSUPPORTED_ROUTE");
      return train.search(q);
    },
  };
}

export default createKoreaTagoProvider({ train: trainSeed });
