import "server-only";
import { distanceKm } from "../gtfs/geo";
import { ProviderFailure, type Offer, type Place, type SearchQuery, type Segment, type TransportProvider } from "../../types";
import { servesModes } from "../stub";

const MODES = ["train"] as const;
const CHECKED = "2026-10-04";

/** One leg of a crossing on a frequent urban line: no timetable, so any time inside service hours works. */
export interface ConnectorPart { carrier: string; from: Place; to: Place; durationMin: number }

/**
 * A ground link no timetable covers, such as metro to the border, the checkpoint and metro on the other side. Every
 * figure is typical, never quoted: offers are `estimated`.
 */
export interface Connector {
  id: string;
  /** Searches starting and ending within `radiusKm` of these points use it: all of Hong Kong, airport included. */
  from: Place;
  to: Place;
  radiusKm: number;
  /** In order. The time between parts is the crossing. */
  parts: [ConnectorPart, ConnectorPart];
  crossingMin: number;
  /** One adult fare for the whole way, in one currency; `note` says how it adds up. */
  fare: { amount: number; currency: string; note: string };
  /** First and last departures that still make the last train on the far side, local "HH:MM". */
  first: string;
  last: string;
  sources: string[];
}

const ADMIRALTY: Place = { name: "Admiralty (MTR)", lat: 22.2793, lng: 114.1650, country: "HK" };
const LO_WU: Place = { name: "Lo Wu (MTR)", lat: 22.5283, lng: 114.1131, country: "HK" };
const LUOHU: Place = { name: "Luohu (Shenzhen Metro)", lat: 22.5320, lng: 114.1176, country: "CN" };
const SHENZHEN_NORTH: Place = { name: "Shenzhen North", lat: 22.6119, lng: 114.0239, country: "CN" };

const SOURCES = [
  "https://www.hkutilitymap.com/en/mtr-fare/lo-wu",
  "https://www.td.gov.hk/en/transport_in_hong_kong/land_based_cross_boundary_transport/access_to_lo_wu_control_point/index.html",
  "https://www.rome2rio.com/s/Shenzhen-Luohu/Shenzhen-North-Station",
];

// MTR East Rail HK$52.2 (Octopus, Admiralty–Lo Wu) + Shenzhen Metro about ¥5 (≈ HK$5.4).
const FARE = { amount: 58, currency: "HKD", note: "MTR HK$52 + Shenzhen Metro about ¥5" };

export const CONNECTORS: readonly Connector[] = [
  {
    id: "hk-shenzhen-north",
    from: ADMIRALTY, to: SHENZHEN_NORTH, radiusKm: 30,
    parts: [
      { carrier: "MTR East Rail", from: ADMIRALTY, to: LO_WU, durationMin: 45 },
      { carrier: "Shenzhen Metro", from: LUOHU, to: SHENZHEN_NORTH, durationMin: 30 },
    ],
    crossingMin: 30, fare: FARE, first: "06:04", last: "22:00", sources: SOURCES,
  },
  {
    id: "shenzhen-north-hk",
    from: SHENZHEN_NORTH, to: ADMIRALTY, radiusKm: 30,
    parts: [
      { carrier: "Shenzhen Metro", from: SHENZHEN_NORTH, to: LUOHU, durationMin: 30 },
      { carrier: "MTR East Rail", from: LO_WU, to: ADMIRALTY, durationMin: 45 },
    ],
    crossingMin: 30, fare: FARE, first: "06:30", last: "22:30", sources: SOURCES,
  },
];

export const connectorMinutes = (c: Connector) => c.parts[0].durationMin + c.crossingMin + c.parts[1].durationMin;

/** Both zones are UTC+8 without DST. */
const at = (date: string, minutes: number) => {
  const wall = new Date(Date.parse(`${date}T00:00:00Z`) + minutes * 60_000).toISOString().slice(0, 19);
  return `${wall}+08:00`;
};
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The connector as one offer leaving at `leave` minutes after local midnight on `date`. */
export function connectorOffer(c: Connector, date: string, leave: number): Offer {
  const [a, b] = c.parts;
  const segments: Segment[] = [
    { mode: "train", carrier: a.carrier, from: a.from, to: a.to, depart: at(date, leave), arrive: at(date, leave + a.durationMin), durationMin: a.durationMin },
    {
      mode: "train", carrier: b.carrier, from: b.from, to: b.to,
      depart: at(date, leave + a.durationMin + c.crossingMin),
      arrive: at(date, leave + a.durationMin + c.crossingMin + b.durationMin), durationMin: b.durationMin,
    },
  ];
  return {
    id: `cross-border:${c.id}:${date}:${leave}`,
    provider: "cross-border",
    mode: "train",
    kind: "estimated",
    segments,
    // the Shenzhen Metro part changes lines once (Line 1 to Line 4), on top of the change at the border
    transfers: 2,
    price: { amount: c.fare.amount, currency: c.fare.currency, asOf: CHECKED },
    attribution: `Typical metro and border crossing, checked ${CHECKED}: ${c.fare.note}; about ${c.crossingMin} min at the checkpoint, longer at peaks. Trains run every few minutes. ${c.sources.join("; ")}`,
  };
}

const near = (p: Place, q: Place, km: number) => distanceKm(p.lat, p.lng, q.lat, q.lng) <= km;
export const connectorsFor = (from: Place, to: Place) =>
  CONNECTORS.filter((c) => near(from, c.from, c.radiusKm) && near(to, c.to, c.radiusKm));

/** Trains run every few minutes; a few departures across the day stand in for "any time". */
const SHOWN = ["07:00", "09:00", "12:00", "15:00", "18:00", "21:00"];

export function createCrossBorderProvider(): TransportProvider {
  return {
    id: "cross-border",
    modes: [...MODES],
    covers: (q: SearchQuery) => servesModes(MODES, q) && connectorsFor(q.from, q.to).length > 0,
    async search(q) {
      const found = connectorsFor(q.from, q.to);
      if (!found.length) throw new ProviderFailure("UNSUPPORTED_ROUTE");
      return found.flatMap((c) => SHOWN.map(minutesOf)
        .filter((m) => m >= minutesOf(c.first) && m <= minutesOf(c.last))
        .map((m) => connectorOffer(c, q.date, m)));
    },
  };
}

export default createCrossBorderProvider();
