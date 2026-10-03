import { describe, expect, it } from "vitest";

import { FLAG_ART } from "./flag-art";

describe("FLAG_ART", () => {
  it.each(Object.entries(FLAG_ART))("%s is a 14×10 grid with a colour for every letter", (_, art) => {
    expect(art.rows).toHaveLength(10);
    for (const row of art.rows) {
      expect(row).toHaveLength(14);
      for (const c of row) expect(art.inks[c]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
