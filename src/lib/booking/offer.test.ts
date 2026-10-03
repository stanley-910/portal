import { describe, expect, it } from "vitest";

import { matchOffer, offerExpired, offerSchema, perSeat, sameFlights, travellerSchema } from "./offer";

const raw = (over: Record<string, unknown> = {}, seats = 1) => ({
  id: "off_1",
  total_amount: "294.24",
  total_currency: "USD",
  expires_at: "2026-10-03T12:08:07Z",
  owner: { name: "Duffel Airways" },
  passengers: Array.from({ length: seats }, (_, i) => ({ id: `pas_${i}` })),
  passenger_identity_documents_required: false,
  payment_requirements: { requires_instant_payment: false, payment_required_by: "2026-10-06T11:38:07Z", price_guarantee_expires_at: "2026-10-05T11:38:07Z" },
  slices: [
    {
      segments: [
        {
          marketing_carrier: { iata_code: "ZZ", name: "Duffel Airways" },
          marketing_carrier_flight_number: "3551",
          departing_at: "2026-10-23T17:01:00",
          arriving_at: "2026-10-23T19:40:00",
          origin: { iata_code: "HKG" },
          destination: { iata_code: "PVG" },
        },
      ],
    },
  ],
  ...over,
});

describe("offerSchema", () => {
  it("reads what booking needs", () => {
    const offer = offerSchema.parse(raw({}, 2));
    expect(offer).toMatchObject({
      id: "off_1",
      total: { amount: 294.24, currency: "USD" },
      passengerIds: ["pas_0", "pas_1"],
      instantOnly: false,
      documentsRequired: false,
      origin: "HKG",
      destination: "PVG",
      date: "2026-10-23",
    });
    expect(offer.flights).toEqual([{ number: "ZZ3551", departingAt: "2026-10-23T17:01:00", arrivingAt: "2026-10-23T19:40:00", from: "HKG", to: "PVG" }]);
    expect(perSeat(offer)).toEqual({ amount: 147.12, currency: "USD" });
    expect(offerExpired(offer, Date.parse("2026-10-03T12:00:00Z"))).toBe(false);
    expect(offerExpired(offer, Date.parse("2026-10-03T12:08:07Z"))).toBe(true);
  });
});

describe("matchOffer", () => {
  const like = offerSchema.parse(raw());

  it("finds the cheapest fare on the same flights with the right number of seats", () => {
    const found = matchOffer(
      like,
      [
        raw({ id: "off_other", slices: [{ segments: [{ ...raw().slices[0].segments[0], marketing_carrier_flight_number: "3552" }] }] }, 3),
        raw({ id: "off_dear", total_amount: "500.00" }, 3),
        raw({ id: "off_cheap", total_amount: "441.36" }, 3),
        raw({ id: "off_two_seats" }, 2),
        "junk",
      ],
      3,
    );
    expect(found?.id).toBe("off_cheap");
  });

  it("is null when the flights aren't there", () => {
    expect(matchOffer(like, [raw({ slices: [{ segments: [{ ...raw().slices[0].segments[0], departing_at: "2026-10-23T18:01:00" }] }] })], 1)).toBeNull();
    expect(matchOffer(like, [], 1)).toBeNull();
  });

  it("compares every segment of a connection", () => {
    const seg = raw().slices[0].segments[0];
    const viaSeg = { ...seg, destination: { iata_code: "TPE" }, marketing_carrier_flight_number: "100" };
    const onward = { ...seg, origin: { iata_code: "TPE" }, marketing_carrier_flight_number: "200", departing_at: "2026-10-23T21:00:00" };
    const connection = offerSchema.parse(raw({ slices: [{ segments: [viaSeg, onward] }] }));
    expect(sameFlights(connection, offerSchema.parse(raw({ slices: [{ segments: [viaSeg, onward] }] })))).toBe(true);
    expect(sameFlights(connection, offerSchema.parse(raw({ slices: [{ segments: [viaSeg, { ...onward, marketing_carrier_flight_number: "201" }] }] })))).toBe(false);
    expect(sameFlights(connection, like)).toBe(false);
  });
});

describe("travellerSchema", () => {
  const ok = { title: "ms", gender: "f", givenName: "Amelia", familyName: "Earhart", bornOn: "1987-07-24", email: "amelia@example.com", phone: "+442080160509" };

  it("accepts a traveller without a passport when none is required", () => {
    expect(travellerSchema(false).parse(ok).passport).toBeNull();
    expect(travellerSchema(false).safeParse({ ...ok, phone: "02080160509" }).success).toBe(false);
    expect(travellerSchema(false).safeParse({ ...ok, bornOn: "2999-01-01" }).success).toBe(false);
  });

  it("reads a phone in the picked country, or the one its + or 00 names", () => {
    const phone = (p: string, phoneCountry?: string) => travellerSchema(false).safeParse({ ...ok, phone: p, phoneCountry }).data?.phone;
    expect(phone("9123 4567", "HK")).toBe("+85291234567");
    expect(phone("+852 9123-4567")).toBe("+85291234567");
    expect(phone("00852 9123 4567", "US")).toBe("+85291234567");
    expect(phone("(415) 555-2671", "US")).toBe("+14155552671");
    expect(phone("010-1234-5678", "KR")).toBe("+821012345678");
    // without a country, a local number can't be placed; nor can a number the country doesn't hand out
    expect(phone("9123 4567")).toBeUndefined();
    expect(phone("+852 1234 5678")).toBeUndefined();
    expect(travellerSchema(false).parse({ ...ok, phoneCountry: "HK" })).not.toHaveProperty("phoneCountry");
  });

  it("insists on a passport when the airline does", () => {
    expect(travellerSchema(true).safeParse(ok).success).toBe(false);
    const parsed = travellerSchema(true).parse({ ...ok, passport: { number: "K1234567", country: "gb", expiresOn: "2031-01-01" } });
    expect(parsed.passport).toEqual({ number: "K1234567", country: "GB", expiresOn: "2031-01-01" });
  });
});
