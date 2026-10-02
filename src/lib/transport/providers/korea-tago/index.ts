import "server-only";
import { ProviderFailure, type Mode, type SearchQuery, type TransportProvider } from "../../types";
import { servesModes } from "../stub";
import { createBusSearch } from "./bus";
import type { BusSeed, TrainSeed } from "./schema";
import { busSeed, trainSeed } from "./seed";
import { createTrainSearch } from "./train";

// Korea = hand-curated seed, no data.go.kr calls (ADR-T05 trains, ADR-B07 express buses). Provider id stays `korea-tago`.
const TRAIN: Mode[] = ["train"];
const BUS: Mode[] = ["bus"];

export function createKoreaTagoProvider(seeds: { train: TrainSeed; bus?: BusSeed }): TransportProvider {
  const train = createTrainSearch(seeds.train);
  const bus = seeds.bus && createBusSearch(seeds.bus);
  const trainCovers = (q: SearchQuery) => servesModes(TRAIN, q) && train.covers(q);
  const busCovers = (q: SearchQuery) => !!bus && servesModes(BUS, q) && bus.covers(q);

  return {
    id: "korea-tago",
    modes: bus ? [...TRAIN, ...BUS] : [...TRAIN],
    covers: (q) => trainCovers(q) || busCovers(q),
    async search(q) {
      const wantTrain = trainCovers(q);
      const wantBus = busCovers(q);
      if (!wantTrain && !wantBus) throw new ProviderFailure("UNSUPPORTED_ROUTE");
      return [...(wantTrain ? train.search(q) : []), ...(wantBus && bus ? bus.search(q) : [])].sort(
        (a, b) => Date.parse(a.segments[0].depart) - Date.parse(b.segments[0].depart),
      );
    },
  };
}

export default createKoreaTagoProvider({ train: trainSeed, bus: busSeed });
