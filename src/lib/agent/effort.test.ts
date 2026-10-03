import { describe, expect, it } from "vitest";
import { effortFor } from "./effort";

const step = (...names: string[]) => ({ toolCalls: names.map((toolName) => ({ toolName })) });

describe("effortFor", () => {
  it("starts low and stays low for edits and reads", () => {
    expect(effortFor([])).toBe("low");
    expect(effortFor([step("edit_plan"), step("get_trip")])).toBe("low");
  });

  it("thinks hard once a planning tool has returned", () => {
    expect(effortFor([step("get_trip"), step("optimize_leg", "get_trip")])).toBe("high");
    expect(effortFor([step("find_meetup")])).toBe("high");
  });
});
