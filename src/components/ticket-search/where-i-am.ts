// Where the person is, for ranking the airports near where they click. Asked for once, the first time they take off,
// so it's usually in by the time they land; held in memory only, and sent with searches in a header (lib/transport/near).
import { formatNear, NEAR_HEADER } from "@/lib/transport/near";

let here: { lat: number; lng: number } | null = null;
let asked = false;

/** Asks the browser where the person is, once a page load. Declining, or no answer, leaves searches without it. */
export function askWhereIAm() {
  if (asked || typeof navigator === "undefined" || !navigator.geolocation) return;
  asked = true;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      here = { lat: position.coords.latitude, lng: position.coords.longitude };
    },
    () => {},
    { enableHighAccuracy: false, maximumAge: 60 * 60_000, timeout: 15_000 },
  );
}

/** The header that tells a search where the person is, or none while that's unknown. */
export const whereIAmHeaders = (): Record<string, string> => (here ? { [NEAR_HEADER]: formatNear(here) } : {});
