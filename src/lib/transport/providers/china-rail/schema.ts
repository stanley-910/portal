export interface Station {
  city: string; // city label; coordinate searches consider every nearby station
  name: string;
  nameLocal: string;
  country: "CN" | "HK";
  lat: number;
  lng: number;
  telecode?: string; // 12306 code from station_name.js, ≠ IATA
  source: string;
}

/** One train: typical local departures + duration, cited. */
export interface SeedTrain {
  from: string; // Station key
  to: string;
  number: string; // G/D train number
  departures: string[]; // "HH:MM", local at origin
  durationMin: number;
  tz: "Asia/Shanghai" | "Asia/Hong_Kong";
  source: string;
}

export interface Seed {
  checked: string; // YYYY-MM-DD the sources were read
  stations: Record<string, Station>;
  trains: SeedTrain[];
}
