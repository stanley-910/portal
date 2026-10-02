import "server-only";
import type { TransportProvider } from "./types";
import busonlineticket from "./providers/busonlineticket";
import chinaRail from "./providers/china-rail";
import gtfs from "./providers/gtfs";
import koreaTago from "./providers/korea-tago";
import srt from "./providers/srt";
import tdx from "./providers/tdx";
import travelpayouts from "./providers/travelpayouts";
import twelveGo from "./providers/12go";

// Written once in C01 (ADR-C02). Adapter tasks replace providers/<id>/index.ts, never this list.
export const providers: readonly TransportProvider[] = [
  travelpayouts,
  twelveGo,
  tdx,
  koreaTago,
  chinaRail,
  busonlineticket,
  gtfs,
  srt,
];
