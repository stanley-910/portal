import busSeedJson from "./bus-seed.json";
import busTerminalsJson from "./bus-terminals.json";
import {
  busSeedSchema,
  busTerminalsSchema,
  trainSeedSchema,
  trainStationsSchema,
  type BusSeed,
  type TrainSeed,
} from "./schema";
import trainSeedJson from "./train-seed.json";
import trainStationsJson from "./train-stations.json";

// Seed loaders for korea-tago: trains, express buses.

export function parseTrainSeed(stations: unknown, seed: unknown): TrainSeed {
  const s = { ...trainSeedSchema.parse(seed), stations: trainStationsSchema.parse(stations) };
  for (const t of s.trains) {
    if (!(t.from in s.stations) || !(t.to in s.stations) || t.from === t.to) {
      throw new Error(`korea-tago train ${t.number}: unknown or same station ${t.from}>${t.to}`);
    }
  }
  return s;
}

export function parseBusSeed(terminals: unknown, seed: unknown): BusSeed {
  const s = { ...busSeedSchema.parse(seed), terminals: busTerminalsSchema.parse(terminals) };
  for (const b of s.buses) {
    if (!(b.from in s.terminals) || !(b.to in s.terminals) || b.from === b.to) {
      throw new Error(`korea-tago bus: unknown or same terminal ${b.from}>${b.to}`);
    }
  }
  return s;
}

// Parsed once at module load; a bad seed fails the seed test, not a request.
export const trainSeed = parseTrainSeed(trainStationsJson, trainSeedJson);
export const busSeed = parseBusSeed(busTerminalsJson, busSeedJson);
