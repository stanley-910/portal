import "server-only";
import type { TransportProvider } from "./types";
import busonlineticket from "./providers/busonlineticket";
import chinaRail from "./providers/china-rail";
import duffel from "./providers/duffel";
import gtfs from "./providers/gtfs";
import koreaTago from "./providers/korea-tago";
import srt from "./providers/srt";
import tdx from "./providers/tdx";
import travelpayouts from "./providers/travelpayouts";
import twelveGo from "./providers/12go";
import vietnamRail from "./providers/vietnam-rail";

// The provider list. Each provider lives in providers/<id>/index.ts; adding one never means editing the others.
export const providers: readonly TransportProvider[] = [
  duffel,
  travelpayouts,
  twelveGo,
  tdx,
  koreaTago,
  chinaRail,
  busonlineticket,
  gtfs,
  srt,
  vietnamRail,
];
