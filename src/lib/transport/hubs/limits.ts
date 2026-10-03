// Shared geography limits without importing the server catalogue into the browser.
export const HUB_LIMITS = {
  radiusKm: { flight: 200, train: 100, ferry: 60 },
  candidatesPerMode: 3,
  flightPairs: 4,
} as const;
