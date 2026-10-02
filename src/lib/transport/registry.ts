import { twelveGo } from "./providers/12go";
import { travelpayouts } from "./providers/travelpayouts";
import type { TransportProvider } from "./types";

export const providers: TransportProvider[] = [travelpayouts, twelveGo];
