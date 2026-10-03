import { describe, expect, it } from "vitest";

import { legOffer } from "./leg-tags";

const offer = (id: string, mode: "flight" | "train") => ({ id, mode }) as never;
const search = { offers: [offer("a", "flight"), offer("b", "train"), offer("c", "train")] } as never;

describe("legOffer", () => {
  it("shows the pick, else the most-voted option, else nothing", () => {
    expect(legOffer({ chosen: offer("c", "train"), votes: { a: ["x", "y"] }, search })).toMatchObject({ id: "c" });
    expect(legOffer({ chosen: null, votes: { a: ["x"], b: ["y", "z"] }, search })).toMatchObject({ id: "b" });
    // a tie goes to the option ranked first
    expect(legOffer({ chosen: null, votes: { c: ["x"], a: ["y"] }, search })).toMatchObject({ id: "a" });
    expect(legOffer({ chosen: null, votes: {}, search })).toBeNull();
  });
});
