import { writeFile } from "node:fs/promises";

const source = "https://api.travelpayouts.com/data/en/airports.json";
const output = new URL("../src/lib/transport/providers/travelpayouts/airports.json", import.meta.url);

type SourceAirport = {
  code?: string;
  city_code?: string;
  country_code?: string;
  coordinates?: { lat?: number; lon?: number };
  flightable?: boolean;
  iata_type?: string;
};

const response = await fetch(source);
if (!response.ok) throw new Error(`Airport snapshot failed: ${response.status}`);
const airports = (await response.json()) as SourceAirport[];
const snapshot = airports
  .filter((airport) => airport.flightable && airport.code && airport.coordinates?.lat !== undefined && airport.coordinates.lon !== undefined)
  .map((airport) => ({
    code: airport.code,
    ...(airport.city_code ? { city_code: airport.city_code } : {}),
    ...(airport.country_code ? { country_code: airport.country_code } : {}),
    coordinates: { lat: airport.coordinates!.lat, lon: airport.coordinates!.lon },
    flightable: true,
    ...(airport.iata_type ? { iata_type: airport.iata_type } : {}),
  }));

await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Wrote ${snapshot.length} flightable airports to ${output.pathname}`);
