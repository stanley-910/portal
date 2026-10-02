import { trainSeedSchema, trainStationsSchema, type TrainSeed } from "./schema";
import trainSeedJson from "./train-seed.json";
import trainStationsJson from "./train-stations.json";

// Seed loaders for korea-tago (ADR-T05). B02 adds bus-stations.json / bus-seed.json + parseBusSeed here.

export function parseTrainSeed(stations: unknown, seed: unknown): TrainSeed {
  const s = { ...trainSeedSchema.parse(seed), stations: trainStationsSchema.parse(stations) };
  for (const t of s.trains) {
    if (!(t.from in s.stations) || !(t.to in s.stations) || t.from === t.to) {
      throw new Error(`korea-tago train ${t.number}: unknown or same station ${t.from}>${t.to}`);
    }
  }
  return s;
}

// Parsed once at module load; a bad seed fails the seed test, not a request.
export const trainSeed = parseTrainSeed(trainStationsJson, trainSeedJson);
